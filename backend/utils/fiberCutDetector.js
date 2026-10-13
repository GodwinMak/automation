/**
 * Fiber Cut / Mass Outage Detector
 *
 * Customers that go down within the same fixed 5-minute window are grouped
 * into one "mass outage incident" the moment 5+ of them are down together:
 *   - NBR-scoped incident: 5+ customers down at the same shared location
 *     (matches the physical topology of a localized fiber cut).
 *   - GLOBAL-scoped incident: 5+ customers down network-wide within the
 *     window but not concentrated enough at any single NBR to form its own
 *     NBR incident (matches a backbone/core cut affecting several locations
 *     at once).
 *
 * An incident's membership is locked to customers who went down within
 * [startedAt, startedAt + WINDOW_MINUTES] — once that admission window
 * closes, no further customers join, even if the incident is still open
 * (unrestored). A customer going down later forms/joins a new incident
 * instead. The incident itself stays open for restoration tracking until
 * every admitted member is back up.
 *
 * Called from utils/statusTracker.js every time a batch of status changes is
 * logged, so it sees down/up transitions from every customer type (DIA, IPT,
 * SHARED, L3VPN, FTTH) as they happen.
 */

const db = require("../Models");
const { QueryTypes, Op } = require("sequelize");

const MassOutageIncident = db.massOutageIncidents;
const MassOutageIncidentCustomer = db.massOutageIncidentCustomers;

const WINDOW_MINUTES = 5;
const THRESHOLD_CUSTOMERS = 5;

const HISTORY_TABLES = ["statusChangeHistories", "statusChangeHistories_ftth"];

// Where to look up a customer's actual current status, per type — used to
// self-heal a member stuck "down" whose real up/down transition was missed
// by the event-driven tracker (e.g. a cron restart mid-cycle). Mirrors the
// same verification churnAnalysis.js's getExtendedDowntimeCustomers does
// for the regular downtime view. FTTH keys on "pppoeusername" (that's what's
// stored as the member's "interface" — a stable identity, unlike ip, which
// can change between PPPoE sessions) and reports status via "status", not
// "operationalStatus".
const LIVE_STATUS_LOOKUPS = {
  DIA: { model: () => db.diacustomers, keyField: "interface", statusField: "operationalStatus" },
  IPT: { model: () => db.iptcustomers, keyField: "interface", statusField: "operationalStatus" },
  SHARED: { model: () => db.sharedcustomers, keyField: "interface", statusField: "operationalStatus" },
  L3VPN: { model: () => db.l3vpncustomers, keyField: "interface", statusField: "operationalStatus" },
  FTTH: { model: () => db.ftthcustomers, keyField: "pppoeusername", statusField: "status" },
};

// FTTH has no shared network-location field yet — its "nbr" column is
// actually the customer's own home number (unique per subscriber), not a
// shared node like other types. Never use it to cluster FTTH customers
// together; they still count toward GLOBAL-scoped incidents. Revisit once
// a real OLT/PON/cabinet identifier is available for FTTH.
const getGroupingNbr = (row) => (row.customerType === "FTTH" ? null : row.nbr);

// A customer can only join an incident if it went down within that
// incident's fixed 5-minute admission window (measured from startedAt).
const isWithinAdmissionWindow = (incident, changedAt) => {
  const windowEnd = new Date(incident.startedAt).getTime() + WINDOW_MINUTES * 60 * 1000;
  return new Date(changedAt).getTime() <= windowEnd;
};

// Sequelize's raw-query `replacements` serialize a JS Date using the
// process's LOCAL timezone, not UTC — but changedAt is stored/compared in
// UTC (session time_zone '+00:00'). On a server running outside UTC (e.g.
// East Africa Time, UTC+3) that silently shifts the cutoff hours into the
// future, so it never matches any real row. Format explicitly as a UTC
// MySQL DATETIME string instead so there's no ambiguity.
const toMysqlUtcDateTime = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
};

// Latest 'down' transition per (customerType, interface) within the trailing window.
//
// L2VPN is explicitly excluded here, not just in handleStatusChanges below —
// this query runs standalone (re-reading the shared statusChangeHistories
// table straight from the DB) every time processDownGrowthAndCreation is
// triggered by ANY customer type's down event, not just L2VPN's own. So the
// handleStatusChanges guard alone wasn't enough: cron/updateL2VPN.js's
// trackL2VPNCircuitStatusChanges() writes L2VPN status changes into this
// exact same table via trackStatusChanges(), and this query would happily
// pick those rows back up on the next unrelated DIA/IPT/SHARED/L3VPN/FTTH
// down event, feeding them into incident creation despite
// massOutageIncidentCustomer's customerType ENUM not including "L2VPN" and
// neither LIVE_STATUS_LOOKUPS nor the restoration path (also filtered to
// exclude L2VPN) being able to ever reconcile/restore one back out again —
// producing an L2VPN member permanently stuck "down" in an incident that
// can never close, regardless of the customer's real live status (seen in
// production: an L2VPN customer showing "down" here while its own L2VPN
// list page correctly shows it "up").
const getRecentDownEvents = async (now) => {
  const windowStart = toMysqlUtcDateTime(new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000));
  const unionSql = HISTORY_TABLES.map(
    (t) => `
      SELECT interface, customerType, switchName, customerName, cid, nbr, changedAt
      FROM ${t}
      WHERE newStatus = 'down' AND changedAt >= :windowStart AND customerType != 'L2VPN'
    `
  ).join(" UNION ALL ");

  return db.sequelize.query(
    `SELECT u.* FROM (${unionSql}) u
     INNER JOIN (
       SELECT interface, customerType, MAX(changedAt) AS maxChangedAt
       FROM (${unionSql}) u2
       GROUP BY interface, customerType
     ) latest
       ON u.interface = latest.interface
      AND u.customerType = latest.customerType
      AND u.changedAt = latest.maxChangedAt`,
    { replacements: { windowStart }, type: QueryTypes.SELECT }
  );
};

// Interfaces currently tracked as "down" members of a still-OPEN incident.
// Members left "down" on a resolved/closed incident are NOT claimed — they
// were released back to the pool (see getOrphanedStillDownMembers) so a
// customer never stays stuck referencing a dead incident forever.
const getClaimedDownKeys = async () => {
  const rows = await MassOutageIncidentCustomer.findAll({
    where: { status: "down" },
    include: [{ model: MassOutageIncident, as: "incident", where: { status: "open" }, attributes: [] }],
    attributes: ["customerType", "interface"],
    raw: true,
  });
  return new Set(rows.map((r) => `${r.customerType}:${r.interface}`));
};

// Customers still "down" whose incident has since been resolved/closed —
// i.e. never actually restored, just left behind when their incident ended
// (most commonly: manually closed via the UI while some members were still
// down). Grouped so they can be swept back into a fresh incident at the
// same NBR — but only if that old incident ended recently. Without a
// recency bound, a customer left stuck "down" on a closed incident stays
// eligible for adoption forever, so it gets silently folded into every
// future unrelated fiber cut at that NBR, inflating impact counts with
// customers who have nothing to do with the new incident (seen in
// production: three L3VPN customers down since a closed incident 21 days
// earlier got attributed to a fiber cut that started that day).
const ORPHAN_ADOPTION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
// Bounding just the incident's closure recency isn't enough on its own — a
// customer who's been down for weeks on a long-dead incident becomes
// adoptable the instant someone finally closes it, even though their own
// outage has nothing to do with whatever fresh incident is forming right
// now at that NBR (seen in production: a customer down 22 days got
// attributed to an incident whose own impact window was 2 hours old). This
// bounds the member's own downAt age too, so only stragglers whose outage
// is itself still plausibly "recent" get carried forward.
const ORPHAN_MAX_DOWNTIME_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const getOrphanedStillDownMembers = async () => {
  const cutoff = new Date(Date.now() - ORPHAN_ADOPTION_MAX_AGE_MS);
  const downtimeCutoff = new Date(Date.now() - ORPHAN_MAX_DOWNTIME_AGE_MS);
  const rows = await MassOutageIncidentCustomer.findAll({
    where: { status: "down", downAt: { [Op.gte]: downtimeCutoff } },
    include: [
      {
        model: MassOutageIncident,
        as: "incident",
        where: {
          status: { [Op.ne]: "open" },
          [Op.or]: [{ resolvedAt: { [Op.gte]: cutoff } }, { closedAt: { [Op.gte]: cutoff } }],
        },
        attributes: [],
      },
    ],
  });
  return rows;
};

// Re-parent orphaned still-down members at `nbr` onto `targetIncidentId`,
// preserving their original downAt so their reported downtime stays
// continuous across the incident boundary. Returns the set of incident ids
// (old + new) whose counts need refreshing.
const adoptOrphansForNbr = async (nbr, targetIncidentId, orphans) => {
  const touched = new Set();
  if (!nbr) return touched;
  const matches = orphans.filter((o) => o.nbr === nbr && o.incidentId !== targetIncidentId);
  for (const orphan of matches) {
    touched.add(orphan.incidentId);
    await orphan.update({ incidentId: targetIncidentId });
  }
  if (matches.length) {
    touched.add(targetIncidentId);
    console.log(
      `[FiberCutDetector] Re-adopted ${matches.length} still-down customer(s) from closed/resolved incident(s) at NBR ${nbr} into incident ${targetIncidentId}`
    );
  }
  return touched;
};

const addMembers = async (incidentId, rows) => {
  if (!rows.length) return;
  const records = rows.map((r) => ({
    incidentId,
    customerType: r.customerType,
    interface: r.interface,
    switchName: r.switchName || null,
    customerName: r.customerName || null,
    cid: r.cid || null,
    nbr: r.nbr || null,
    status: "down",
    downAt: r.changedAt,
  }));
  await MassOutageIncidentCustomer.bulkCreate(records, { ignoreDuplicates: true });
};

const createIncident = async (scope, nbr, members, now) => {
  const startedAt = members.reduce((min, m) => {
    const t = new Date(m.changedAt);
    return t < min ? t : min;
  }, new Date(members[0].changedAt));

  const incident = await MassOutageIncident.create({
    scope,
    nbr,
    status: "open",
    startedAt,
    detectedAt: now,
    customerCount: 0,
    restoredCount: 0,
  });
  await addMembers(incident.id, members);
  console.log(
    `[FiberCutDetector] New ${scope} incident detected${nbr ? ` at NBR ${nbr}` : ""}: ${members.length} customers down`
  );
  return incident;
};

const refreshIncidentCounts = async (incidentId) => {
  const incident = await MassOutageIncident.findByPk(incidentId);
  if (!incident) return;

  const [customerCount, restoredCount, maxRestoredAt] = await Promise.all([
    MassOutageIncidentCustomer.count({ where: { incidentId } }),
    MassOutageIncidentCustomer.count({ where: { incidentId, status: "restored" } }),
    MassOutageIncidentCustomer.max("restoredAt", { where: { incidentId } }),
  ]);

  const update = { customerCount, restoredCount };
  if (incident.status === "open" && customerCount > 0 && restoredCount === customerCount) {
    update.status = "resolved";
    update.resolvedAt = maxRestoredAt;
    update.totalDurationSeconds = Math.floor(
      (new Date(maxRestoredAt) - new Date(incident.startedAt)) / 1000
    );
    console.log(
      `[FiberCutDetector] Incident ${incidentId} resolved — all ${customerCount} customers restored`
    );
  }
  await incident.update(update);
};

// Mark incident members restored for any interface that just came back up.
const processRestorations = async (upChanges, now) => {
  const touchedIncidentIds = new Set();
  for (const change of upChanges) {
    const members = await MassOutageIncidentCustomer.findAll({
      where: { customerType: change.customerType, interface: change.interface, status: "down" },
    });
    for (const member of members) {
      const downtimeSeconds = Math.floor((now - new Date(member.downAt)) / 1000);
      await member.update({ status: "restored", restoredAt: now, downtimeSeconds });
      touchedIncidentIds.add(member.incidentId);
    }
  }
  return touchedIncidentIds;
};

// True for anything that looks like an IPv4 or IPv6 address.
const isIpLikeAddress = (value) =>
  typeof value === "string" &&
  (/^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-f]*:[0-9a-f:]+$/i.test(value));

// Cross-check a set of "down" member rows against their actual current
// status in the live customer tables, and restore any that are really up —
// catches cases the event-driven up/down tracker missed. Mutates the passed
// Sequelize instances in place so callers can keep using them afterward.
const reconcileDownMembersAgainstLiveStatus = async (members, now) => {
  const touchedIncidentIds = new Set();
  if (!members.length) return touchedIncidentIds;

  const byType = new Map();
  for (const m of members) {
    if (!byType.has(m.customerType)) byType.set(m.customerType, []);
    byType.get(m.customerType).push(m);
  }

  for (const [type, typeMembers] of byType.entries()) {
    const lookup = LIVE_STATUS_LOOKUPS[type];
    if (!lookup) continue;

    const liveStatusByKey = new Map();

    if (type === "FTTH") {
      // Members created before the pppoeusername re-key still have their
      // old IP stored as "interface" — fall back to matching on ip for
      // those so they don't stay stuck unreconcilable forever.
      const usernameMembers = typeMembers.filter((m) => !isIpLikeAddress(m.interface));
      const legacyIpMembers = typeMembers.filter((m) => isIpLikeAddress(m.interface));

      if (usernameMembers.length) {
        const rows = await lookup.model().findAll({
          where: { pppoeusername: { [Op.in]: usernameMembers.map((m) => m.interface) } },
          attributes: ["pppoeusername", "status"],
          raw: true,
        });
        for (const r of rows) liveStatusByKey.set(r.pppoeusername, String(r.status || "").toLowerCase());
      }
      if (legacyIpMembers.length) {
        const rows = await lookup.model().findAll({
          where: { ip: { [Op.in]: legacyIpMembers.map((m) => m.interface) } },
          attributes: ["ip", "status"],
          raw: true,
        });
        for (const r of rows) liveStatusByKey.set(r.ip, String(r.status || "").toLowerCase());
      }
    } else {
      const rows = await lookup.model().findAll({
        where: { [lookup.keyField]: { [Op.in]: typeMembers.map((m) => m.interface) } },
        attributes: [lookup.keyField, lookup.statusField],
        raw: true,
      });
      for (const r of rows) {
        liveStatusByKey.set(r[lookup.keyField], String(r[lookup.statusField] || "").toLowerCase());
      }
    }

    for (const member of typeMembers) {
      if (liveStatusByKey.get(member.interface) !== "up") continue;
      const downtimeSeconds = Math.floor((now - new Date(member.downAt)) / 1000);
      await member.update({ status: "restored", restoredAt: now, downtimeSeconds });
      touchedIncidentIds.add(member.incidentId);
      console.log(
        `[FiberCutDetector] Self-healed ${type} ${member.interface} — actually up, tracker had missed it`
      );
    }
  }

  return touchedIncidentIds;
};

// Reconcile every "down" member of every currently OPEN incident. Cheap and
// bounded (only mass-outage members, not the whole customer base) — safe to
// run on every detector pass so incidents self-heal within minutes even if
// a transition was missed, not just when someone happens to view the page.
const reconcileAllOpenIncidents = async (now) => {
  const members = await MassOutageIncidentCustomer.findAll({
    where: { status: "down" },
    include: [{ model: MassOutageIncident, as: "incident", where: { status: "open" }, attributes: [] }],
  });
  return reconcileDownMembersAgainstLiveStatus(members, now);
};

// How many times (within the lookback window) an interface must already
// have appeared as an incident member before a fresh down is treated as
// "the same recurring problem" instead of yet another new incident. A
// genuinely unstable link otherwise racks up a brand-new GLOBAL/NBR
// incident every time it flaps back down after recovering — its earlier
// membership just gets marked "restored" (see processRestorations above),
// which releases its claim and makes the next down look like a fresh,
// unrelated event. Each of those lingers open (and re-appears in the 12h
// stale-incident escalation email, cron/fiberCutStaleLinksEmail.js) until
// every OTHER, unrelated customer swept into that particular batch also
// happens to recover — seen in production as the same one or two
// chronically-flapping circuits filling an escalation report with dozens
// of near-duplicate rows in a single day.
const FLAP_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours
const FLAP_THRESHOLD = 3; // the 3rd+ down occurrence in the window gets folded back in

// For each row about to join/create a normal incident, check whether this
// exact (customerType, interface) already has 2+ other membership rows (any
// status, any incident status) within the lookback window — i.e. this would
// be its 3rd+ time going down. If so, don't let it participate in normal
// NBR/GLOBAL grouping at all: re-mark it "down" on its own most-recent
// incident (reopening it if it had resolved/closed) instead, so the whole
// flapping series stays one incident rather than spawning a new one on
// every bounce. Deliberately per-interface rather than per-batch — a
// genuine new correlated outage that happens to include an already-chronic
// flapper still folds that one customer back into its own history rather
// than joining the new incident, which is an accepted tradeoff for keeping
// the escalation noise down.
const foldChronicFlapsIntoRecentIncidents = async (pool, now) => {
  const remainingPool = [];
  const touchedIncidentIds = new Set();
  const cutoff = new Date(now.getTime() - FLAP_LOOKBACK_MS);

  for (const r of pool) {
    const priorRows = await MassOutageIncidentCustomer.findAll({
      where: { customerType: r.customerType, interface: r.interface, downAt: { [Op.gte]: cutoff } },
      order: [["downAt", "DESC"]],
    });

    if (priorRows.length < FLAP_THRESHOLD - 1) {
      remainingPool.push(r);
      continue;
    }

    const target = priorRows[0]; // this interface's most recent membership row
    const incident = await MassOutageIncident.findByPk(target.incidentId);
    if (!incident) {
      remainingPool.push(r);
      continue;
    }

    await target.update({
      status: "down",
      downAt: r.changedAt,
      restoredAt: null,
      downtimeSeconds: null,
      switchName: r.switchName || target.switchName,
      customerName: r.customerName || target.customerName,
      cid: r.cid || target.cid,
      nbr: r.nbr || target.nbr,
    });

    if (incident.status !== "open") {
      await incident.update({
        status: "open",
        resolvedAt: null,
        closedAt: null,
        closedByName: null,
        closeComment: null,
        totalDurationSeconds: null,
      });
    }

    console.log(
      `[FiberCutDetector] ${r.customerType} ${r.interface} is a chronic flapper (${priorRows.length + 1} down events in the last 24h) — folded back into incident ${incident.id} instead of creating a new one`
    );
    touchedIncidentIds.add(incident.id);
  }

  return { remainingPool, touchedIncidentIds };
};

// Grow existing open incidents and/or detect brand-new ones from customers
// that went down in the trailing window and aren't already being tracked.
const processDownGrowthAndCreation = async (now) => {
  const [recentDowns, claimedKeys, openIncidents, orphansRaw] = await Promise.all([
    getRecentDownEvents(now),
    getClaimedDownKeys(),
    MassOutageIncident.findAll({ where: { status: "open" }, order: [["detectedAt", "ASC"]] }),
    getOrphanedStillDownMembers(),
  ]);
  let orphans = orphansRaw;

  let pool = recentDowns.filter((r) => !claimedKeys.has(`${r.customerType}:${r.interface}`));
  const touchedIncidentIds = new Set();
  if (!pool.length && !orphans.length) return touchedIncidentIds;

  const { remainingPool, touchedIncidentIds: flapTouched } = await foldChronicFlapsIntoRecentIncidents(pool, now);
  pool = remainingPool;
  flapTouched.forEach((id) => touchedIncidentIds.add(id));

  // Grow existing NBR-scoped incidents first — most specific match. Only
  // customers still inside that incident's admission window may join.
  for (const incident of openIncidents.filter((i) => i.scope === "NBR")) {
    const matches = pool.filter(
      (r) => getGroupingNbr(r) === incident.nbr && isWithinAdmissionWindow(incident, r.changedAt)
    );
    if (matches.length) {
      await addMembers(incident.id, matches);
      touchedIncidentIds.add(incident.id);
      const matchedKeys = new Set(matches.map((m) => `${m.customerType}:${m.interface}`));
      pool = pool.filter((r) => !matchedKeys.has(`${r.customerType}:${r.interface}`));
    }

    // A customer still down since a now-closed/resolved incident at this
    // same NBR is clearly part of the same ongoing outage — fold them in.
    const adopted = await adoptOrphansForNbr(incident.nbr, incident.id, orphans);
    adopted.forEach((id) => touchedIncidentIds.add(id));
    orphans = orphans.filter((o) => o.nbr !== incident.nbr);
  }

  // Leftovers can grow an open GLOBAL incident whose admission window is
  // still active (oldest first).
  const globalIncidents = openIncidents.filter((i) => i.scope === "GLOBAL");
  for (const incident of globalIncidents) {
    if (!pool.length) break;
    const matches = pool.filter((r) => isWithinAdmissionWindow(incident, r.changedAt));
    if (!matches.length) continue;
    await addMembers(incident.id, matches);
    touchedIncidentIds.add(incident.id);
    const matchedKeys = new Set(matches.map((m) => `${m.customerType}:${m.interface}`));
    pool = pool.filter((r) => !matchedKeys.has(`${r.customerType}:${r.interface}`));
  }

  // Detect brand-new NBR incidents from what's left.
  if (pool.length) {
    const byNbr = new Map();
    for (const r of pool) {
      const groupNbr = getGroupingNbr(r);
      if (!groupNbr) continue;
      if (!byNbr.has(groupNbr)) byNbr.set(groupNbr, []);
      byNbr.get(groupNbr).push(r);
    }
    for (const [nbr, members] of byNbr.entries()) {
      if (members.length < THRESHOLD_CUSTOMERS) continue;
      const incident = await createIncident("NBR", members[0].nbr, members, now);
      touchedIncidentIds.add(incident.id);
      const claimed = new Set(members.map((m) => `${m.customerType}:${m.interface}`));
      pool = pool.filter((r) => !claimed.has(`${r.customerType}:${r.interface}`));

      // Sweep in anyone still down from a closed/resolved incident at this
      // same NBR — same ongoing outage, now folded into the fresh incident.
      const adopted = await adoptOrphansForNbr(nbr, incident.id, orphans);
      adopted.forEach((id) => touchedIncidentIds.add(id));
      orphans = orphans.filter((o) => o.nbr !== nbr);
    }
  }

  // Whatever remains (spread across multiple NBRs / unassigned) may still
  // constitute a wider, backbone-level incident.
  if (pool.length >= THRESHOLD_CUSTOMERS) {
    const incident = await createIncident("GLOBAL", null, pool, now);
    touchedIncidentIds.add(incident.id);
  }

  return touchedIncidentIds;
};

/**
 * Entry point — call after every batch of status changes is logged.
 * @param {Array} changes - the transitions just recorded (from statusTracker)
 * @param {Date} now - the timestamp the batch was recorded at
 */
const handleStatusChanges = async (changes, now) => {
  if (!changes || !changes.length) return;
  try {
    // L2VPN circuit tracking (added to trackStatusChanges as of the Churn
    // Analysis integration) is deliberately excluded here for now — mass
    // outage grouping isn't wired up for it yet: massOutageIncidentCustomer's
    // customerType ENUM doesn't include "L2VPN", and neither
    // LIVE_STATUS_LOOKUPS nor DEVICE_SCOPED_CUSTOMER_MODELS below have an
    // L2VPN entry. Without this guard, a circuit going "down" would still
    // enter getRecentDownEvents' customerType-agnostic raw SQL query and
    // count toward GLOBAL-scoped incident thresholds while every per-member
    // DB write for it fails on the ENUM constraint. Remove this filter when
    // L2VPN is deliberately wired into fiber-cut detection.
    const trackableChanges = changes.filter((c) => c.customerType !== "L2VPN");
    if (!trackableChanges.length) return;

    const downChanges = trackableChanges.filter((c) => c.newStatus === "down");
    const upChanges = trackableChanges.filter((c) => c.newStatus === "up");

    const touchedIncidentIds = new Set();

    if (upChanges.length) {
      const restored = await processRestorations(upChanges, now);
      restored.forEach((id) => touchedIncidentIds.add(id));
    }

    if (downChanges.length) {
      const grown = await processDownGrowthAndCreation(now);
      grown.forEach((id) => touchedIncidentIds.add(id));
    }

    // Self-heal: catch any member the event-driven tracker above missed,
    // by checking their actual live status directly.
    const reconciled = await reconcileAllOpenIncidents(now);
    reconciled.forEach((id) => touchedIncidentIds.add(id));

    for (const id of touchedIncidentIds) {
      await refreshIncidentCounts(id);
    }
  } catch (error) {
    console.error("[FiberCutDetector] Error handling status changes:", error.message);
  }
};

// Live customer tables that have a "switchName" (device) concept — FTTH is
// excluded, same as the NBR-grouping logic above (see getGroupingNbr):
// it has no shared network-location field yet.
const DEVICE_SCOPED_CUSTOMER_MODELS = {
  DIA: () => db.diacustomers,
  IPT: () => db.iptcustomers,
  SHARED: () => db.sharedcustomers,
  L3VPN: () => db.l3vpncustomers,
};

// ISIS neighbor names that are known external peers (other operators/
// regions) rather than our own managed devices — they'll never appear in
// the `devices` table, so warning about them every cycle is just noise.
// getIsolatedDeviceIds already handles them correctly either way (an
// unmatched name simply never contributes a state — see addState below),
// this only suppresses the recurring log line for names already confirmed
// external. A name showing up unmatched that ISN'T in this set still warns,
// since that could be a genuine inventory gap worth investigating.
const KNOWN_EXTERNAL_NEIGHBORS = new Set([
  "LKE-P1-MSA",
  "LKE-P4-MSA",
  "LZA-P2-TDN",
  "LZA-P3-JHB",
  "LZA-P4-JHB",
  "LTZ-ACC2-MBE",
  "LTZ-FW01-TIG-Node0",
  "LDJ-PE2-JIB",
]);

// How long a stale isis_adjacency row is still trusted as current truth.
// ~7x the cron's 2-minute cadence — generous enough to ride out a couple of
// skipped/slow cycles without letting a genuinely stuck row (e.g. a device
// whose SSH stats call keeps failing) permanently poison the isolation
// aggregate below. Shared with Controller/isisAdjacent.js so the UI and the
// customer-impacting isolation check agree on what counts as "current".
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * A device counts as "isolated" when EVERY *fresh* ISIS adjacency touching
 * it — from its own perspective (local_device_id) OR a neighbor's
 * perspective (neighbor_name) — is Down. The neighbor's-side view matters
 * because a fully-cut device usually can't be SSHed into either, so its own
 * adjacency rows just go stale instead of flipping to Down; its
 * still-reachable neighbors are what actually confirm the isolation. Rows
 * older than STALE_THRESHOLD_MS are excluded rather than trusted as-is —
 * genuinely isolated devices are still caught because their neighbors keep
 * reporting fresh Down rows every cycle.
 */
const getIsolatedDeviceIds = async () => {
  const [devices, adjacencies] = await Promise.all([
    db.devices.findAll({ attributes: ["id", "name"], raw: true }),
    db.isisAdjacency.findAll({ attributes: ["local_device_id", "neighbor_name", "state", "last_checked"], raw: true }),
  ]);

  const nameById = new Map(devices.map((d) => [d.id, d.name]));
  // Normalized (trimmed, lower-cased) name -> device id, so a harmless
  // whitespace/case mismatch between a router's advertised neighbor name
  // and the inventory's devices.name doesn't silently drop a fresh
  // observation (addState below just no-ops on an unmatched id).
  const idByNormalizedName = new Map(devices.map((d) => [String(d.name).trim().toLowerCase(), d.id]));
  const unmatchedNeighborNames = new Set();

  // deviceId -> array of "Up"/"Down" states from every non-stale adjacency
  // row that mentions it, from either side.
  const relevantStateById = new Map();
  const addState = (deviceId, state) => {
    if (!deviceId) return;
    if (!relevantStateById.has(deviceId)) relevantStateById.set(deviceId, []);
    relevantStateById.get(deviceId).push(state);
  };

  const staleCutoff = Date.now() - STALE_THRESHOLD_MS;
  for (const a of adjacencies) {
    if (a.last_checked && new Date(a.last_checked).getTime() < staleCutoff) continue;

    addState(a.local_device_id, a.state);
    const neighborId = idByNormalizedName.get(String(a.neighbor_name || "").trim().toLowerCase());
    if (neighborId) {
      addState(neighborId, a.state);
    } else if (a.neighbor_name && !KNOWN_EXTERNAL_NEIGHBORS.has(a.neighbor_name)) {
      unmatchedNeighborNames.add(a.neighbor_name);
    }
  }

  if (unmatchedNeighborNames.size) {
    console.warn(`[FiberCutDetector] ${unmatchedNeighborNames.size} neighbor name(s) with no matching device in inventory: ${[...unmatchedNeighborNames].join(", ")}`);
  }

  const isolatedIds = new Set();
  for (const [deviceId, states] of relevantStateById.entries()) {
    if (states.length > 0 && states.every((s) => s === "Down")) {
      isolatedIds.add(deviceId);
    }
  }
  return { isolatedIds, nameById };
};

/**
 * Called after every ISIS adjacency polling cycle (cron/isisAdjacent.js).
 * Finds devices with zero working ISIS adjacencies and force-marks every
 * customer hosted on them as down — covering the gap where the normal
 * per-type customer poller can't SSH into an isolated device to check its
 * customers directly, so those customers would otherwise sit stale/"up"
 * indefinitely despite a real outage.
 */
const checkDeviceIsolation = async (now) => {
  try {
    const { isolatedIds, nameById } = await getIsolatedDeviceIds();

    // Keep devices.isIsolated in sync for visibility, and log transitions
    // in both directions (not every 2-minute tick while it stays isolated).
    const allDevices = await db.devices.findAll();
    for (const device of allDevices) {
      const isolatedNow = isolatedIds.has(device.id);
      if (isolatedNow && !device.isIsolated) {
        await device.update({ isIsolated: true, isolatedAt: now });
        console.log(`[FiberCutDetector] Device ${device.name} is now COMPLETELY ISOLATED (no working ISIS adjacencies)`);
      } else if (!isolatedNow && device.isIsolated) {
        await device.update({ isIsolated: false, isolatedAt: null });
        console.log(`[FiberCutDetector] Device ${device.name} has RECOVERED (at least one ISIS adjacency is back up)`);
      }
    }

    const isolatedNames = new Set([...isolatedIds].map((id) => nameById.get(id)).filter(Boolean));

    const changes = [];
    if (isolatedNames.size) {
      // Required lazily to avoid a circular require: statusTracker.js
      // requires this file at module load, so requiring it back at this
      // file's top level would hand back a half-initialized module.
      const {
        getDiaCustomerInfoMap,
        getIptCustomerInfoMap,
        getSharedCustomerInfoMap,
        getL3vpnCustomerInfoMap,
        notifyDownTransitions,
      } = require("./statusTracker");

      const infoMapByType = {
        DIA: getDiaCustomerInfoMap,
        IPT: getIptCustomerInfoMap,
        SHARED: getSharedCustomerInfoMap,
        L3VPN: getL3vpnCustomerInfoMap,
      };

      for (const [customerType, getModel] of Object.entries(DEVICE_SCOPED_CUSTOMER_MODELS)) {
        const model = getModel();
        const affected = await model.findAll({
          where: {
            switchName: { [Op.in]: [...isolatedNames] },
            operationalStatus: { [Op.ne]: "down" },
          },
          raw: true,
        });
        if (!affected.length) continue;

        const customerInfoMap = await infoMapByType[customerType]();

        for (const c of affected) {
          const info = customerInfoMap[c.interface] || {};
          changes.push({
            customerId: info.id || null,
            customerType,
            interface: c.interface,
            switchName: c.switchName || null,
            customerName: info.customerName || null,
            cid: info.cid || null,
            nbr: info.nbr || null,
            previousStatus: String(c.operationalStatus || "unknown").toLowerCase(),
            newStatus: "down",
            durationInPreviousState: 0,
            changedAt: now,
            notes: `Marked down — hosting device (${c.switchName}) is completely isolated (no working ISIS adjacencies)`,
          });
        }

        // Force the live table to reflect reality even though we can't SSH
        // the isolated device to confirm each customer individually — the
        // whole point of this check is to cover the case where normal
        // polling can't reach it at all.
        await model.update(
          { operationalStatus: "down" },
          { where: { interface: { [Op.in]: affected.map((c) => c.interface) } } }
        );
      }

      if (changes.length) {
        await db.statusChangeHistories.bulkCreate(changes);
        console.log(`[FiberCutDetector] Forced ${changes.length} customer(s) down due to device isolation`);
        await notifyDownTransitions(changes);
        // Reuse the existing mass-outage grouping/creation logic — it
        // re-reads recent down events from statusChangeHistories, which now
        // includes the rows just inserted above, and handles reconciliation
        // internally too.
        await handleStatusChanges(changes, now);
      }
    }

    if (!changes.length) {
      // Nothing new was forced down this cycle, but still give previously
      // isolation-forced members a chance to self-heal once their device
      // recovers and their own poller reports them "up" again — that
      // recovery wouldn't otherwise trigger handleStatusChanges on its own.
      const reconciled = await reconcileAllOpenIncidents(now);
      for (const id of reconciled) {
        await refreshIncidentCounts(id);
      }
    }
  } catch (error) {
    console.error("[FiberCutDetector] Error checking device isolation:", error.message);
  }
};

module.exports = {
  handleStatusChanges,
  reconcileDownMembersAgainstLiveStatus,
  refreshIncidentCounts,
  checkDeviceIsolation,
  getIsolatedDeviceIds,
  STALE_THRESHOLD_MS,
  WINDOW_MINUTES,
  THRESHOLD_CUSTOMERS,
};
