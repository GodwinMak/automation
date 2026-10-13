/**
 * One-off: adds the canViewProcessMonitoring column to the existing users
 * table. Models/index.js runs sync({ force: false }) on every boot, which
 * does not add columns to a table that already exists, so this needs to
 * run once against the live DB (same reason scripts/addUserSmsColumns.js
 * exists for canReceiveIsisSms/phoneNumber).
 *
 * Usage (from backend/): node scripts/addProcessMonitoringPermissionColumn.js
 */
const db = require("../Models");

const run = async () => {
  await db.sequelize.authenticate();
  const qi = db.sequelize.getQueryInterface();
  const table = await qi.describeTable("users");

  if (!table.canViewProcessMonitoring) {
    await qi.addColumn("users", "canViewProcessMonitoring", {
      type: db.Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    console.log("[Migrate] Added users.canViewProcessMonitoring");
  } else {
    console.log("[Migrate] users.canViewProcessMonitoring already exists, skipping");
  }

  console.log("[Migrate] Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("[Migrate] Failed:", err);
  process.exit(1);
});
