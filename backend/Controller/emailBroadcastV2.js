const db = require("../Models");
const { Op, fn, col } = require("sequelize");

const SERVICE_TYPE_MODELS = {
  DIA: db.customerinfos,
  IPT: db.iptcustomerinfos,
  SHARED: db.sharedcustomerinfos,
  L3VPN: db.l3vpncustomerinfos,
};
const NON_FTTH_TYPES = Object.keys(SERVICE_TYPE_MODELS);
const SWITCH_TYPES = [...NON_FTTH_TYPES, "L2VPN"];
const ALL_TYPES = [...SWITCH_TYPES, "FTTH"];

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

const parseNbrsParam = (raw) =>
  String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const normalizeEmail = (value) => {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
};

const toRecipient = ({
  customerType,
  customerName,
  cid,
  interfaceValue,
  switchName,
  nbr,
  emailAddress,
  lastDownAt,
}) => ({
  key: `${customerType}:${interfaceValue || cid || customerName || Math.random()}`,
  customerType,
  customerName: customerName || null,
  cid: cid || null,
  interface: interfaceValue || null,
  switchName: switchName || null,
  nbr: nbr || null,
  emailAddress: emailAddress || null,
  hasEmail: !!emailAddress,
  ...(lastDownAt ? { lastDownAt } : {}),
});

const summarize = (mode, recipients, meta) => ({
  mode,
  recipients,
  total: recipients.length,
  withEmail: recipients.filter((r) => r.hasEmail).length,
  withoutEmail: recipients.filter((r) => !r.hasEmail).length,
  meta,
});

const resolveEmailsByCid = async (cids) => {
  const emailByCid = new Map();
  const uniqueCids = [...new Set(cids.filter(Boolean))];
  if (!uniqueCids.length) return emailByCid;

  const rows = await db.client_dbs.findAll({
    where: { network_cid: { [Op.in]: uniqueCids } },
    attributes: ["network_cid", "email_address"],
    raw: true,
  });

  for (const row of rows) {
    const email = normalizeEmail(row.email_address);
    if (!email) continue;
    if (!emailByCid.has(row.network_cid)) emailByCid.set(row.network_cid, email);
  }
  return emailByCid;
};

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
    console.error("[Email v2 Switches] Error:", err);
    res.status(500).json({ error: "Failed to fetch switches.", details: err.message });
  }
};

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

  const emailByCid = await resolveEmailsByCid(rows.map((r) => r.cid));
  const recipients = rows.map((r) => toRecipient({ ...r, emailAddress: emailByCid.get(r.cid) }));

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
    const customers = await db.ftthcustomerinfos.findAll({
      attributes: ["customerID", "customerName", "emailAddress"],
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
        emailAddress: normalizeEmail(c.emailAddress),
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
    const cids = interfaces.map((i) => vcidByInterfaceId.get(i.id)).filter(Boolean);
    const emailByCid = await resolveEmailsByCid(cids);

    const recipients = interfaces.map((i) => {
      const cid = vcidByInterfaceId.get(i.id) || null;
      return toRecipient({
        customerType: "L2VPN",
        customerName: i.customerName,
        cid,
        interfaceValue: i.unit ? `${i.interface}.${i.unit}` : i.interface,
        switchName: i.switchName,
        nbr: i.switchName,
        emailAddress: cid ? emailByCid.get(cid) : null,
      });
    });

    return summarize("byServiceType", recipients, { serviceType: type });
  }

  const rows = await SERVICE_TYPE_MODELS[type].findAll({
    attributes: ["customerName", "cid", "nbr", "interface"],
    raw: true,
  });

  const emailByCid = await resolveEmailsByCid(rows.map((r) => r.cid));
  const recipients = rows.map((r) =>
    toRecipient({
      customerType: type,
      customerName: r.customerName,
      cid: r.cid,
      interfaceValue: r.interface,
      switchName: r.nbr,
      nbr: r.nbr,
      emailAddress: emailByCid.get(r.cid),
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
        downMap.set(key, { type, interfaceValue, switchName: r.switchName || nbr || null, nbr });
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
  const nbrs = parseNbrsParam(switchName);

  const baseWhere = {
    newStatus: "down",
    changedAt: { [Op.gte]: new Date(startDate), [Op.lte]: new Date(endDate) },
  };
  if (nbrs.length) baseWhere.nbr = { [Op.in]: nbrs };

  const nonFtthSelected = types.filter((t) => t !== "FTTH");
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
  // This avoids showing interfaces that recovered to up after a down event in-range.
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

  const [diaInfos, iptInfos, sharedInfos, l3vpnInfos, ftthInfos] = await Promise.all([
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
    ftthCustomerIds.length
      ? db.ftthcustomerinfos.findAll({ where: { customerID: { [Op.in]: [...new Set(ftthCustomerIds)] } }, attributes: ["customerID", "customerName", "emailAddress"], raw: true })
      : Promise.resolve([]),
  ]);

  const infoByTypeInterface = new Map();
  for (const r of diaInfos) infoByTypeInterface.set(`DIA:${r.interface}`, r);
  for (const r of iptInfos) infoByTypeInterface.set(`IPT:${r.interface}`, r);
  for (const r of sharedInfos) infoByTypeInterface.set(`SHARED:${r.interface}`, r);
  for (const r of l3vpnInfos) infoByTypeInterface.set(`L3VPN:${r.interface}`, r);

  const ftthByCustomerId = new Map(ftthInfos.map((r) => [r.customerID, r]));

  const allCids = [];
  for (const [key, rec] of filteredDeduped.entries()) {
    const t = rec.customerType;
    if (t === "FTTH") continue;
    const info = infoByTypeInterface.get(key);
    if (info?.cid) allCids.push(info.cid);
  }
  const emailByCid = await resolveEmailsByCid(allCids);

  const recipients = [];
  for (const [key, rec] of filteredDeduped.entries()) {
    const t = rec.customerType;
    if (t === "FTTH") {
      const down = currentlyDown.get(`FTTH:${rec.interface}`);
      const cid = rec.customerId || down?.customerID || null;
      const ftthInfo = cid ? ftthByCustomerId.get(cid) : null;
      recipients.push(
        toRecipient({
          customerType: "FTTH",
          customerName: ftthInfo?.customerName || null,
          cid,
          interfaceValue: rec.interface,
          switchName: null,
          nbr: null,
          emailAddress: normalizeEmail(ftthInfo?.emailAddress),
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
        emailAddress: emailByCid.get(info.cid || rec.cid),
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

exports.previewRecipientsV2 = async (req, res) => {
  const { mode } = req.query;
  try {
    let result;
    if (mode === "bySwitch") result = await previewBySwitch(req);
    else if (mode === "byServiceType") result = await previewByServiceType(req);
    else if (mode === "byDowntime") result = await previewByDowntime(req);
    else return res.status(400).json({ error: "mode must be one of bySwitch, byServiceType, byDowntime." });

    return res.status(200).json(result);
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    console.error("[Email v2 Preview] Error:", err);
    return res.status(500).json({ error: "Failed to fetch recipients.", details: err.message });
  }
};
