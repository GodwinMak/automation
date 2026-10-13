/**
 * One-off: adds the composite (customerType, interface, changedAt) index to
 * statusChangeHistories and statusChangeHistories_ftth. Both indexes were
 * added to the model definitions (statusChangeHistory.js, statusChangeHistoryFtth.js)
 * after the tables already existed in production, and Models/index.js's
 * sync({ force: false }) never retrofits indexes onto an existing table — so
 * without this, the "latest status per interface" self-join subquery used by
 * getExtendedDowntimeCustomers (Controller/churnAnalysis.js) and
 * initializeCache (utils/statusTracker.js) runs without the index it was
 * designed for, doing a full scan of a table that grows continuously.
 *
 * Usage (from backend/): node scripts/addStatusHistoryIndexes.js
 */
const db = require("../Models");

const TARGETS = [
  { table: "statusChangeHistories", indexName: "idx_sch_type_iface_at" },
  { table: "statusChangeHistories_ftth", indexName: "idx_sch_ftth_type_iface_at" },
];

const run = async () => {
  await db.sequelize.authenticate();
  const qi = db.sequelize.getQueryInterface();

  for (const { table, indexName } of TARGETS) {
    const existing = await qi.showIndex(table);
    const alreadyExists = existing.some((idx) => idx.name === indexName);

    if (alreadyExists) {
      console.log(`[Migrate] ${table}.${indexName} already exists, skipping`);
      continue;
    }

    console.log(`[Migrate] Adding ${indexName} on ${table} (customerType, interface, changedAt)...`);
    await qi.addIndex(table, {
      name: indexName,
      fields: ["customerType", "interface", "changedAt"],
    });
    console.log(`[Migrate] Added ${indexName} on ${table}`);
  }

  console.log("[Migrate] Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("[Migrate] Failed:", err);
  process.exit(1);
});
