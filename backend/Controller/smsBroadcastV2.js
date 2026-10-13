const db = require("../Models");
const { Op, fn, col } = require("sequelize");

// Non-FTTH service types — each has a customer/name/cid/nbr "info" table.
// Recipient selection and the switch/nbr picker read entirely from these;
// the corresponding core status tables (diacustomers etc.) aren't needed
// here. FTTH is handled separately — it has no info table or nbr concept.
const SERVICE_TYPE_MODELS = {
  DIA: db.customerinfos,
  IPT: db.iptcustomerinfos,
  SHARED: db.sharedcustomerinfos,
  L3VPN: db.l3vpncustomerinfos,
};
const NON_FTTH_TYPES = Object.keys(SERVICE_TYPE_MODELS);
const SWITCH_TYPES = [...NON_FTTH_TYPES, "L2VPN"];
const ALL_TYPES = [...SWITCH_TYPES, "FTTH"];

// Parse a "DIA,IPT" CSV param into a validated array of known types.
// `allowFtth` controls whether FTTH is accepted as one of the values.
const normalizeServiceTypesParam = (csv, allowFtth) => {
  const allowed = allowFtth ? ALL_TYPES : SWITCH_TYPES;
  if (!csv) return allowed;
  const requested = String(csv)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const valid = requested.filter((t) => allowed.includes(t));
  return valid.length ? valid : allowed;
};

const isTruthy = (value) => ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

// Batch-resolve phone numbers for non-FTTH customers via client_db, keyed by
// cid (client_db.network_cid <-> info.cid — an unenforced, free-text join
// populated by manual billing-sheet upload, so coverage is never guaranteed).
const resolvePhonesByCid = async (cids) => {
  const phoneByCid = new Map();
  const uniqueCids = [...new Set(cids.filter(Boolean))];
  if (!uniqueCids.length) return phoneByCid;

  const rows = await db.client_dbs.findAll({
    where: { network_cid: { [Op.in]: uniqueCids } },
    attributes: ["network_cid", "phone_number"],
    raw: true,
  });
  for (const row of rows) {
    if (!row.phone_number) continue;
    if (!phoneByCid.has(row.network_cid)) {
      phoneByCid.set(row.network_cid, row.phone_number);
    }
  }
  return phoneByCid;
};

const toRecipient = ({
  customerType,
  customerName,
  cid,
  interfaceValue,
  switchName,
  nbr,
  phoneNumber,
  lastDownAt,
}) => ({
  key: `${customerType}:${interfaceValue || cid || customerName || Math.random()}`,
  customerType,
  customerName: customerName || null,
  cid: cid || null,
  interface: interfaceValue || null,
  switchName: switchName || null,
  nbr: nbr || null,
  phoneNumber: phoneNumber || null,
  hasPhone: !!phoneNumber,
  ...(lastDownAt ? { lastDownAt } : {}),
});

const summarize = (mode, recipients, meta) => ({
  mode,
  recipients,
  total: recipients.length,
  withPhone: recipients.filter((r) => r.hasPhone).length,
  withoutPhone: recipients.filter((r) => !r.hasPhone).length,
  meta,
});

/**
 * GET /sms/v2/switches?search=
 * Distinct switch locations sourced from "nbr" on the four info tables
 * (customerinfo.js, iptcustomerinfo.js, sharedCustomerinfo.js,
 * L3VPNCustomerinfo.js) — nbr is documented on those models as "switch
 * where customer is found". This is deliberately NOT switchName on the
 * core tables: nbr is the field actually populated/synced per-customer,
 * so it's the reliable one to select recipients by.
 */
exports.getSwitches = async (req, res) => {
  const { search } = req.query;
  try {
    const perType = await Promise.all(
      NON_FTTH_TYPES.map(async (type) => {
        const where = { nbr: { [Op.ne]: null } };
        if (search) where.nbr[Op.like] = `%${search}%`;
        const rows = await SERVICE_TYPE_MODELS[type].findAll({
          attributes: ["nbr", [fn("COUNT", col("nbr")), "count"]],
          where,
          group: ["nbr"],
          raw: true,
        });
        return { type, rows };
      })
    );

    const l2vpnWhere = { switchName: { [Op.ne]: null } };
    if (search) l2vpnWhere.switchName[Op.like] = `%${search}%`;
    const l2vpnRows = await db.l2vpninterfaces.findAll({
      attributes: [["switchName", "nbr"], [fn("COUNT", col("switchName")), "count"]],
      where: l2vpnWhere,
      group: ["switchName"],
      raw: true,
    });
    perType.push({ type: "L2VPN", rows: l2vpnRows });

    const bySwitch = new Map();
    for (const { type, rows } of perType) {
      for (const row of rows) {
        const name = row.nbr;
        const count = parseInt(row.count, 10) || 0;
        if (!bySwitch.has(name)) {
          bySwitch.set(name, { switchName: name, totalCustomers: 0, byType: {} });
        }
        const entry = bySwitch.get(name);
        entry.totalCustomers += count;
        entry.byType[type] = count;
      }
    }

    const switches = [...bySwitch.values()].sort((a, b) => b.totalCustomers - a.totalCustomers);
    res.status(200).json({ switches, total: switches.length });
  } catch (err) {
    console.error("[SMS v2 Switches] Error:", err);
    res.status(500).json({ error: "Failed to fetch switches.", details: err.message });
  }
};

// "switchName" on the wire is a CSV of one or more nbr values — the switch
// picker is multi-select, so a single customer-facing "switch" filter can
// span several actual nbr values at once.
const parseNbrsParam = (raw) =>
  String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const previewBySwitch = async (req) => {
  const { switchName, serviceTypes, highProfileOnly } = req.query;
  const nbrs = parseNbrsParam(switchName);
  if (!nbrs.length) throw { status: 400, message: "switchName is required for mode=bySwitch." };
  const highProfile = isTruthy(highProfileOnly);

  const types = normalizeServiceTypesParam(serviceTypes, false);

  const perType = await Promise.all(
    types.map(async (type) => {
      if (type === "L2VPN") {
        if (highProfile) return [];
        const interfaces = await db.l2vpninterfaces.findAll({
          attributes: ["id", "customerName", "switchName", "interface", "unit"],
          where: { switchName: { [Op.in]: nbrs } },
          raw: true,
        });
        if (!interfaces.length) return [];

        const circuits = await db.l2vpncircuits.findAll({
          where: { l2vpnInterfaceId: { [Op.in]: interfaces.map((i) => i.id) } },
          attributes: ["l2vpnInterfaceId", "virtualCircuitId"],
          raw: true,
        });
        const vcidByInterfaceId = new Map(circuits.map((c) => [c.l2vpnInterfaceId, c.virtualCircuitId]));

        return interfaces.map((i) => ({
          customerType: "L2VPN",
          customerName: i.customerName,
          cid: vcidByInterfaceId.get(i.id) || null,
          interfaceValue: i.unit ? `${i.interface}.${i.unit}` : i.interface,
          switchName: i.switchName,
          nbr: i.switchName,
        }));
      }

      const where = {
        nbr: { [Op.in]: nbrs },
        ...(highProfile ? { isHighProfile: true } : {}),
      };
      const rows = await SERVICE_TYPE_MODELS[type].findAll({
        attributes: ["customerName", "cid", "nbr", "interface"],
        where,
        raw: true,
      });

      return rows.map((r) => ({
        customerType: type,
        customerName: r.customerName,
        cid: r.cid,
        interfaceValue: r.interface,
        switchName: r.nbr,
        nbr: r.nbr,
      }));
    })
  );

  const rows = perType.flat();

  const phoneByCid = await resolvePhonesByCid(rows.map((r) => r.cid));
  const recipients = rows.map((r) => toRecipient({ ...r, phoneNumber: phoneByCid.get(r.cid) }));

  return summarize("bySwitch", recipients, {
    switchNames: nbrs,
    serviceTypes: types,
    highProfileOnly: highProfile,
    l2vpnHighProfileExcluded: highProfile && types.includes("L2VPN")
      ? "L2VPN circuits do not have high-profile flags and were excluded."
      : undefined,
  });
};

const previewByServiceType = async (req) => {
  const { serviceType } = req.query;
  const type = String(serviceType || "").toUpperCase();
  if (!ALL_TYPES.includes(type)) {
    throw { status: 400, message: `serviceType must be one of ${ALL_TYPES.join(", ")}.` };
  }

  if (type === "FTTH") {
    const customers = await db.ftthcustomers.findAll({
      attributes: ["customerID", "customerName", "homeNumber"],
      order: [["customerName", "ASC"]],
      raw: true,
    });
    const recipients = customers.map((c) =>
      toRecipient({
        customerType: "FTTH",
        customerName: c.customerName,
        cid: c.customerID,
        interfaceValue: null,
        switchName: null,
        nbr: null,
        phoneNumber: c.homeNumber,
      })
    );
    return summarize("byServiceType", recipients, { serviceType: type });
  }

  if (type === "L2VPN") {
    const interfaces = await db.l2vpninterfaces.findAll({
      attributes: ["id", "customerName", "switchName", "interface", "unit"],
      raw: true,
    });
    if (!interfaces.length) return summarize("byServiceType", [], { serviceType: type });

    const circuits = await db.l2vpncircuits.findAll({
      where: { l2vpnInterfaceId: { [Op.in]: interfaces.map((i) => i.id) } },
      attributes: ["l2vpnInterfaceId", "virtualCircuitId"],
      raw: true,
    });
    const vcidByInterfaceId = new Map(circuits.map((c) => [c.l2vpnInterfaceId, c.virtualCircuitId]));
    const vcids = interfaces.map((i) => vcidByInterfaceId.get(i.id)).filter(Boolean);
    const phoneByCid = await resolvePhonesByCid(vcids);

    const recipients = interfaces.map((i) => {
      const cid = vcidByInterfaceId.get(i.id) || null;
      return toRecipient({
        customerType: "L2VPN",
        customerName: i.customerName,
        cid,
        interfaceValue: i.unit ? `${i.interface}.${i.unit}` : i.interface,
        switchName: i.switchName,
        nbr: i.switchName,
        phoneNumber: cid ? phoneByCid.get(cid) : null,
      });
    });

    return summarize("byServiceType", recipients, { serviceType: type });
  }

  const info = SERVICE_TYPE_MODELS[type];
  const rows = await info.findAll({
    attributes: ["customerName", "cid", "nbr", "interface"],
    raw: true,
  });

  const cids = rows.map((r) => r.cid);
  const phoneByCid = await resolvePhonesByCid(cids);
  const recipients = rows.map((r) =>
    toRecipient({
      customerType: type,
      customerName: r.customerName,
      cid: r.cid,
      interfaceValue: r.interface,
      switchName: r.nbr,
      nbr: r.nbr,
      phoneNumber: phoneByCid.get(r.cid),
    })
  );

  return summarize("byServiceType", recipients, { serviceType: type });
};

const getCurrentlyDownMaps = async (selectedTypes, nbrs) => {
  const downMap = new Map();

  const addRows = (type, rows, getInterface, getNbr) => {
    for (const r of rows) {
      const interfaceValue = getInterface(r);
      if (!interfaceValue) continue;
      const nbr = getNbr ? getNbr(r) : null;
      if (nbrs.length && nbr && !nbrs.includes(nbr)) continue;
      const key = `${type}:${interfaceValue}`;
      if (!downMap.has(key)) {
        downMap.set(key, {
          type,
          interfaceValue,
          switchName: r.switchName || nbr || null,
          nbr,
        });
      }
    }
  };

  if (selectedTypes.includes("DIA")) {
    const rows = await db.diacustomers.findAll({
      where: { operationalStatus: "down" },
      attributes: ["interface", "switchName"],
      raw: true,
    });
    addRows("DIA", rows, (r) => r.interface, (r) => r.switchName);
  }
  if (selectedTypes.includes("IPT")) {
    const rows = await db.iptcustomers.findAll({
      where: { operationalStatus: "down" },
      attributes: ["interface", "switchName"],
      raw: true,
    });
    addRows("IPT", rows, (r) => r.interface, (r) => r.switchName);
  }
  if (selectedTypes.includes("SHARED")) {
    const rows = await db.sharedcustomers.findAll({
      where: { operationalStatus: "down" },
      attributes: ["interface", "switchName"],
      raw: true,
    });
    addRows("SHARED", rows, (r) => r.interface, (r) => r.switchName);
  }
  if (selectedTypes.includes("L3VPN")) {
    const rows = await db.l3vpncustomers.findAll({
      where: { operationalStatus: "down" },
      attributes: ["interface", "switchName"],
      raw: true,
    });
    addRows("L3VPN", rows, (r) => r.interface, (r) => r.switchName);
  }
  if (selectedTypes.includes("FTTH")) {
    const rows = await db.ftthcustomers.findAll({
      where: { status: "down" },
      attributes: ["pppoeusername", "customerID"],
      raw: true,
    });
    for (const r of rows) {
      if (!r.pppoeusername) continue;
      const key = `FTTH:${r.pppoeusername}`;
      if (!downMap.has(key)) {
        downMap.set(key, {
          type: "FTTH",
          interfaceValue: r.pppoeusername,
          switchName: null,
          nbr: null,
          customerID: r.customerID || null,
        });
      }
    }
  }

  return downMap;
};

const previewByDowntime = async (req) => {
  const { startDate, endDate, serviceTypes, switchName } = req.query;
  if (!startDate || !endDate) {
    throw { status: 400, message: "startDate and endDate are required for mode=byDowntime." };
  }

  const types = normalizeServiceTypesParam(serviceTypes, true);
  const nonFtthSelected = types.filter((t) => t !== "FTTH");
  const nbrs = parseNbrsParam(switchName);

  const baseWhere = {
    newStatus: "down",
    changedAt: { [Op.gte]: new Date(startDate), [Op.lte]: new Date(endDate) },
  };
  // The switch picker is nbr-based (see getSwitches) and multi-select — match
  // the same field here so switches chosen in the picker actually filter.
  if (nbrs.length) baseWhere.nbr = { [Op.in]: nbrs };

  const [nonFtthRows, ftthRows] = await Promise.all([
    nonFtthSelected.length
      ? db.statusChangeHistories.findAll({
          where: { ...baseWhere, customerType: { [Op.in]: nonFtthSelected } },
          order: [["changedAt", "DESC"]],
          raw: true,
        })
      : Promise.resolve([]),
    types.includes("FTTH")
      ? db.statusChangeHistoriesFtth.findAll({
          where: baseWhere,
          order: [["changedAt", "DESC"]],
          raw: true,
        })
      : Promise.resolve([]),
  ]);

  const deduped = new Map();
  for (const r of nonFtthRows) {
    const key = `${r.customerType}:${r.interface}`;
    if (!deduped.has(key)) deduped.set(key, r);
  }
  for (const r of ftthRows) {
    const key = `FTTH:${r.interface}`;
    if (!deduped.has(key)) deduped.set(key, r);
  }

  // Restrict to customers that are currently down, but only among those
  // that had a down event within the selected time range.
  const currentlyDown = await getCurrentlyDownMaps(types, nbrs);

  // Keep only customers that are actually down now.
  // This avoids showing links that had a down event in-range but recovered to up.
  const filteredDeduped = new Map();
  for (const [key, rec] of deduped.entries()) {
    if (currentlyDown.has(key)) filteredDeduped.set(key, rec);
  }

  const nonFtthInterfacesByType = {
    DIA: [], IPT: [], SHARED: [], L3VPN: [],
  };
  const ftthCustomerIds = [];

  for (const rec of filteredDeduped.values()) {
    const t = rec.customerType;
    if (t === "FTTH") {
      if (rec.customerId) ftthCustomerIds.push(rec.customerId);
      const down = currentlyDown.get(`FTTH:${rec.interface}`);
      if (down && down.customerID) ftthCustomerIds.push(down.customerID);
    } else if (nonFtthInterfacesByType[t]) {
      nonFtthInterfacesByType[t].push(rec.interface);
    }
  }

  const [diaInfos, iptInfos, sharedInfos, l3vpnInfos] = await Promise.all([
    nonFtthInterfacesByType.DIA.length
      ? db.customerinfos.findAll({ where: { interface: { [Op.in]: nonFtthInterfacesByType.DIA } }, attributes: ["interface", "customerName", "cid", "nbr"], raw: true })
      : Promise.resolve([]),
    nonFtthInterfacesByType.IPT.length
      ? db.iptcustomerinfos.findAll({ where: { interface: { [Op.in]: nonFtthInterfacesByType.IPT } }, attributes: ["interface", "customerName", "cid", "nbr"], raw: true })
      : Promise.resolve([]),
    nonFtthInterfacesByType.SHARED.length
      ? db.sharedcustomerinfos.findAll({ where: { interface: { [Op.in]: nonFtthInterfacesByType.SHARED } }, attributes: ["interface", "customerName", "cid", "nbr"], raw: true })
      : Promise.resolve([]),
    nonFtthInterfacesByType.L3VPN.length
      ? db.l3vpncustomerinfos.findAll({ where: { interface: { [Op.in]: nonFtthInterfacesByType.L3VPN } }, attributes: ["interface", "customerName", "cid", "nbr"], raw: true })
      : Promise.resolve([]),
  ]);

  const infoByTypeInterface = new Map();
  for (const r of diaInfos) infoByTypeInterface.set(`DIA:${r.interface}`, r);
  for (const r of iptInfos) infoByTypeInterface.set(`IPT:${r.interface}`, r);
  for (const r of sharedInfos) infoByTypeInterface.set(`SHARED:${r.interface}`, r);
  for (const r of l3vpnInfos) infoByTypeInterface.set(`L3VPN:${r.interface}`, r);

  const allCids = [];
  for (const [key, rec] of filteredDeduped.entries()) {
    if (rec.customerType === "FTTH") continue;
    const info = infoByTypeInterface.get(key);
    if (info?.cid) allCids.push(info.cid);
  }
  const phoneByCid = await resolvePhonesByCid(allCids);

  const ftthPhoneById = new Map();
  if (ftthCustomerIds.length) {
    const ftthCustomers = await db.ftthcustomers.findAll({
      where: { customerID: { [Op.in]: [...new Set(ftthCustomerIds)] } },
      attributes: ["customerID", "homeNumber"],
      raw: true,
    });
    for (const c of ftthCustomers) {
      if (c.homeNumber) ftthPhoneById.set(c.customerID, c.homeNumber);
    }
  }

  const recipients = [];
  for (const [key, rec] of filteredDeduped.entries()) {
    const t = rec.customerType;
    if (t === "FTTH") {
      const down = currentlyDown.get(`FTTH:${rec.interface}`);
      const cid = rec.customerId || down?.customerID || null;
      recipients.push(
        toRecipient({
          customerType: "FTTH",
          customerName: rec.customerName || null,
          cid,
          interfaceValue: rec.interface,
          switchName: null,
          nbr: null,
          phoneNumber: cid ? ftthPhoneById.get(cid) : null,
          lastDownAt: rec.changedAt,
        })
      );
      continue;
    }

    const info = infoByTypeInterface.get(key) || {};
    recipients.push(
      toRecipient({
        customerType: t,
        customerName: info.customerName || rec.customerName || null,
        cid: info.cid || rec.cid || null,
        interfaceValue: rec.interface,
        switchName: info.nbr || rec.nbr || null,
        nbr: info.nbr || rec.nbr || null,
        phoneNumber: phoneByCid.get(info.cid || rec.cid),
        lastDownAt: rec.changedAt,
      })
    );
  }

  return summarize("byDowntime", recipients, {
    startDate,
    endDate,
    serviceTypes: types,
    switchNames: nbrs.length ? nbrs : null,
    includesCurrentlyDown: true,
  });
};

/**
 * GET /sms/v2/preview?mode=bySwitch|byServiceType|byDowntime
 */
exports.previewRecipientsV2 = async (req, res) => {
  const { mode } = req.query;
  try {
    let result;
    if (mode === "bySwitch") result = await previewBySwitch(req);
    else if (mode === "byServiceType") result = await previewByServiceType(req);
    else if (mode === "byDowntime") result = await previewByDowntime(req);
    else return res.status(400).json({ error: "mode must be one of bySwitch, byServiceType, byDowntime." });

    res.status(200).json(result);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error("[SMS v2 Preview] Error:", err);
    res.status(500).json({ error: "Failed to fetch recipients.", details: err.message });
  }
};
