/**
 * One-off: permanently deletes mass-outage-incident member rows whose
 * customerType is blank — the L2VPN rows that got silently coerced from
 * "L2VPN" to "" on insert (see cleanupUnreconcilableOutageMembers.js's
 * header comment for the full mechanism). This is the delete-based
 * counterpart to that script: rather than marking these "restored" (which
 * keeps a nonsensical zero-identity row around forever, just no longer
 * blocking incident closure), this removes them outright — there's no
 * salvageable data in a row whose customerType, and therefore whose
 * "which live table do I even check" identity, was never recorded.
 *
 * Deliberately scoped to customerType === "" specifically (not "any
 * non-reconcilable type" the way cleanupUnreconcilableOutageMembers.js is)
 * — this only removes rows definitively confirmed corrupted, not anything
 * that might legitimately be a different value in the future.
 *
 * Usage (from backend/):
 *   node scripts/removeBlankCustomerTypeOutageMembers.js            # dry run — reports only
 *   node scripts/removeBlankCustomerTypeOutageMembers.js --apply    # actually deletes + refreshes counts
 */
const db = require("../Models");
const { refreshIncidentCounts } = require("../utils/fiberCutDetector");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  await db.sequelize.authenticate();

  const blank = await db.massOutageIncidentCustomers.findAll({
    where: { customerType: "" },
  });

  if (blank.length === 0) {
    console.log("No blank-customerType members found — nothing to do.");
    return;
  }

  console.log(`Found ${blank.length} blank-customerType member row(s) across ${new Set(blank.map((r) => r.incidentId)).size} incident(s).`);

  if (!APPLY) {
    console.log(`\nDry run only — no changes made. Re-run with --apply to delete these rows and refresh incident counts.`);
    return;
  }

  const affectedIncidentIds = new Set(blank.map((r) => r.incidentId));
  const idsToDelete = blank.map((r) => r.id);

  // Delete in chunks — 2000+ rows in a single IN(...) is fine for MySQL, but
  // chunking keeps this safe regardless of how large the backlog is.
  const CHUNK_SIZE = 500;
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
    const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
    deleted += await db.massOutageIncidentCustomers.destroy({ where: { id: chunk } });
  }
  console.log(`Deleted ${deleted} row(s).`);

  let refreshed = 0;
  for (const incidentId of affectedIncidentIds) {
    await refreshIncidentCounts(incidentId);
    refreshed += 1;
  }
  console.log(`Refreshed counts for ${refreshed} affected incident(s).`);
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
