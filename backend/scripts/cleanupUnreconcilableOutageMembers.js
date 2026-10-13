/**
 * One-off: finds mass-outage-incident members stuck permanently "down" that
 * can never be self-healed, and marks them "restored" so their incidents can
 * finally close.
 *
 * utils/fiberCutDetector.js's self-healing check (reconcileDownMembersAgainstLiveStatus)
 * only knows how to verify a member's real status for types listed in
 * LIVE_STATUS_LOOKUPS — DIA, IPT, SHARED, L3VPN, FTTH. Before this fix,
 * getRecentDownEvents() had no customerType filter, so L2VPN status changes
 * (written into the same statusChangeHistories table by
 * cron/updateL2VPN.js's trackL2VPNCircuitStatusChanges) could get swept into
 * mass_outage_incident_customers despite that table's customerType ENUM not
 * even including "L2VPN" — landing as either the literal string "L2VPN" or,
 * depending on the DB's strict-mode setting, a silently-coerced blank value.
 * Either way, no code path can ever mark that row "restored" again: it isn't
 * one of the five reconcilable types, and it's excluded from the up-transition
 * path (processRestorations) too. It stays "down" forever regardless of the
 * customer's real live status, keeping its incident open (or, once auto-closed
 * by the 12h escalation email, keeping wrong historical data) indefinitely.
 *
 * This targets exactly that: any "down" member whose customerType isn't one
 * of the five reconcilable types. That's a correctness invariant, not a
 * guess — a legitimately-tracked member can only ever be one of those five
 * (see LIVE_STATUS_LOOKUPS / massOutageIncidentCustomer's own ENUM), so
 * anything else is definitionally unreconcilable data that arrived before
 * getRecentDownEvents' customerType != 'L2VPN' filter existed.
 *
 * Marks matching rows "restored" (downtimeSeconds computed from their
 * recorded downAt to now) rather than deleting them — unlike
 * fixMisattributedOutageMembers.js's misattributed rows, these did
 * legitimately observe a real (if untracked) down event; the customer just
 * isn't lying about being down anymore and there's no live source of truth
 * left to re-verify against. Affected incidents' counts are then refreshed,
 * which naturally resolves any incident this was the last "down" member of.
 *
 * Usage (from backend/):
 *   node scripts/cleanupUnreconcilableOutageMembers.js            # dry run — reports only
 *   node scripts/cleanupUnreconcilableOutageMembers.js --apply    # actually marks restored + refreshes counts
 */
const db = require("../Models");
const { Op } = require("sequelize");
const { refreshIncidentCounts } = require("../utils/fiberCutDetector");

const RECONCILABLE_TYPES = ["DIA", "IPT", "SHARED", "L3VPN", "FTTH"];
const APPLY = process.argv.includes("--apply");

const run = async () => {
  await db.sequelize.authenticate();

  const stuck = await db.massOutageIncidentCustomers.findAll({
    where: {
      status: "down",
      customerType: { [Op.notIn]: RECONCILABLE_TYPES },
    },
    include: [{ model: db.massOutageIncidents, as: "incident", attributes: ["id", "status", "nbr", "scope"] }],
  });

  if (stuck.length === 0) {
    console.log("No unreconcilable stuck-down members found — nothing to do.");
    return;
  }

  const now = new Date();
  console.log(`Found ${stuck.length} unreconcilable stuck-down member row(s):\n`);
  for (const row of stuck) {
    const downtimeDays = ((now - new Date(row.downAt)) / (1000 * 60 * 60 * 24)).toFixed(1);
    console.log(
      `  incident=${row.incidentId} (${row.incident?.status || "?"}, ${row.incident?.scope || "?"} ${row.incident?.nbr || ""}) | ` +
        `${row.customerName || row.interface} (customerType="${row.customerType}") down since ${row.downAt} (${downtimeDays}d)`
    );
  }

  if (!APPLY) {
    console.log(
      `\nDry run only — no changes made. Re-run with --apply to mark these restored and refresh incident counts.`
    );
    return;
  }

  const affectedIncidentIds = new Set(stuck.map((r) => r.incidentId));

  for (const row of stuck) {
    const downtimeSeconds = Math.floor((now - new Date(row.downAt)) / 1000);
    await row.update({ status: "restored", restoredAt: now, downtimeSeconds });
  }
  console.log(`\nMarked ${stuck.length} row(s) restored.`);

  for (const incidentId of affectedIncidentIds) {
    await refreshIncidentCounts(incidentId);
  }
  console.log(`Refreshed counts for ${affectedIncidentIds.size} affected incident(s).`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
