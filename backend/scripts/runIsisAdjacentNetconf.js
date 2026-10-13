/**
 * One-off: run a single dry-run poll of cron/isisAdjacentNetconf.js and
 * print a summary. Writes nothing to the DB and sends no alerts.
 *
 * Usage (from backend/):
 *   node scripts/runIsisAdjacentNetconf.js
 */
const factory = require("../cron/isisAdjacentNetconf");

(async () => {
  const { checkAdjacencyNetconf } = factory(null);
  const startedAt = Date.now();
  try {
    const records = await checkAdjacencyNetconf();
    console.log(`\n[run] Finished in ${Date.now() - startedAt}ms`);
    if (!records) {
      console.log("[run] No records returned (another run holds the lock?)");
    } else {
      const up = records.filter((r) => r.payload.state === "Up").length;
      console.log(`[run] ${records.length} records (${up} Up, ${records.length - up} Down)`);
      console.log("[run] Sample:", JSON.stringify(records.slice(0, 3), null, 2));
    }
  } catch (err) {
    console.error("[run] Failed:", err);
  }
  // Persistent NETCONF sessions + DB pool keep the process alive; close
  // the sessions via the module's SIGINT handler, then exit.
  process.emit("SIGINT");
  setTimeout(() => process.exit(0), 500);
})();
