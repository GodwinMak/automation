/**
 * One-off: finds and removes mass-outage-incident members that were
 * misattributed by the orphan-adoption bug in utils/fiberCutDetector.js
 * (adoptOrphansForNbr had no bound on how long ago the donor incident had
 * closed, so a customer left stuck "down" on a closed incident — most often
 * from a manual close where some members were never restored — stayed
 * eligible to be swept into every future unrelated fiber cut at the same
 * NBR, forever). That's now fixed going forward (a 30-minute recency bound
 * was added), but doesn't retroactively correct incidents that already
 * absorbed a stale member before the fix.
 *
 * Detection is a correctness invariant, not a guess: by construction, every
 * legitimate member's downAt is >= its incident's startedAt (startedAt is
 * the earliest founding member's changedAt, and later joiners are
 * admission-window-bounded — see processDownGrowthAndCreation). The *only*
 * way a row ends up with downAt before its own incident's startedAt is via
 * the orphan-adoption path preserving an old downAt while re-parenting onto
 * a newer incident. So this query finds every historical instance of the
 * bug, not just one incident.
 *
 * Misattributed rows are deleted from mass_outage_incident_customers only —
 * this does NOT touch the customer's actual status/downtime record
 * (statusChangeHistories, live customer tables), which is what Churn
 * Analysis's Extended Downtime view reads from. It just stops that
 * customer's downtime from being double-counted as impact of an unrelated
 * fiber cut. Affected incidents' customerCount/restoredCount are then
 * recomputed to match.
 *
 * Usage (from backend/):
 *   node scripts/fixMisattributedOutageMembers.js            # dry run — reports only
 *   node scripts/fixMisattributedOutageMembers.js --apply    # actually deletes + refreshes counts
 */
const db = require("../Models");
const { Op } = require("sequelize");
const { refreshIncidentCounts } = require("../utils/fiberCutDetector");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await db.sequelize.authenticate();

  const misattributed = await db.sequelize.query(
    `
    SELECT
      mic.id, mic.incidentId, mic.customerType, mic.interface, mic.customerName,
      mic.nbr, mic.status, mic.downAt,
      moi.startedAt AS incidentStartedAt, moi.status AS incidentStatus
    FROM mass_outage_incident_customers mic
    INNER JOIN mass_outage_incidents moi ON moi.id = mic.incidentId
    WHERE mic.downAt < moi.startedAt
    ORDER BY mic.incidentId, mic.downAt
    `,
    { type: db.Sequelize.QueryTypes.SELECT }
  );

  if (misattributed.length === 0) {
    console.log("No misattributed members found — nothing to do.");
    return;
  }

  console.log(`Found ${misattributed.length} misattributed member row(s):\n`);
  for (const row of misattributed) {
    const gapMs = new Date(row.incidentStartedAt) - new Date(row.downAt);
    const gapDays = (gapMs / (1000 * 60 * 60 * 24)).toFixed(1);
    console.log(
      `  incident=${row.incidentId} (${row.incidentStatus}) nbr=${row.nbr} | ` +
        `${row.customerName || row.interface} (${row.customerType}) downAt=${row.downAt} ` +
        `is ${gapDays}d before incident startedAt=${row.incidentStartedAt}`
    );
  }

  if (!APPLY) {
    console.log(`\nDry run only — no changes made. Re-run with --apply to delete these rows and refresh incident counts.`);
    return;
  }

  const affectedIncidentIds = new Set(misattributed.map((r) => r.incidentId));
  const idsToDelete = misattributed.map((r) => r.id);

  await db.massOutageIncidentCustomers.destroy({ where: { id: { [Op.in]: idsToDelete } } });
  console.log(`\nDeleted ${idsToDelete.length} misattributed row(s).`);

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
