/**
 * One-off: adds phoneNumber and canReceiveIsisSms columns to the existing
 * users table. Models/index.js runs sync({ force: false }) on every boot,
 * which does not add columns to a table that already exists, so this needs
 * to run once against the live DB.
 *
 * Usage (from backend/): node scripts/addUserSmsColumns.js
 */
const db = require("../Models");

const run = async () => {
  await db.sequelize.authenticate();
  const qi = db.sequelize.getQueryInterface();
  const table = await qi.describeTable("users");

  if (!table.phoneNumber) {
    await qi.addColumn("users", "phoneNumber", {
      type: db.Sequelize.STRING,
      allowNull: true,
    });
    console.log("[Migrate] Added users.phoneNumber");
  } else {
    console.log("[Migrate] users.phoneNumber already exists, skipping");
  }

  if (!table.canReceiveIsisSms) {
    await qi.addColumn("users", "canReceiveIsisSms", {
      type: db.Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    console.log("[Migrate] Added users.canReceiveIsisSms");
  } else {
    console.log("[Migrate] users.canReceiveIsisSms already exists, skipping");
  }

  console.log("[Migrate] Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("[Migrate] Failed:", err);
  process.exit(1);
});
