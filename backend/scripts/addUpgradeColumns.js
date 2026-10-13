/**
 * One-off: adds the upgrade/downgrade tracking columns (old_upmbps,
 * old_downmbps, expires_at, upgrade_type) to iptcustomerinfos and
 * l3vpncustomerinfos, matching what customerinfos (DIA) already has.
 * Models/index.js runs sync({ force: false }) on every boot, which does not
 * add columns to a table that already exists, so this needs to run once
 * against the live DB.
 *
 * Usage (from backend/): node scripts/addUpgradeColumns.js
 */
const db = require("../Models");

const TABLES = ["iptcustomerinfos", "l3vpncustomerinfos"];

const run = async () => {
  await db.sequelize.authenticate();
  const qi = db.sequelize.getQueryInterface();

  for (const tableName of TABLES) {
    const table = await qi.describeTable(tableName);

    if (!table.old_upmbps) {
      await qi.addColumn(tableName, "old_upmbps", {
        type: db.Sequelize.INTEGER,
        allowNull: true,
      });
      console.log(`[Migrate] Added ${tableName}.old_upmbps`);
    } else {
      console.log(`[Migrate] ${tableName}.old_upmbps already exists, skipping`);
    }

    if (!table.old_downmbps) {
      await qi.addColumn(tableName, "old_downmbps", {
        type: db.Sequelize.INTEGER,
        allowNull: true,
      });
      console.log(`[Migrate] Added ${tableName}.old_downmbps`);
    } else {
      console.log(`[Migrate] ${tableName}.old_downmbps already exists, skipping`);
    }

    if (!table.expires_at) {
      await qi.addColumn(tableName, "expires_at", {
        type: db.Sequelize.DATE,
        allowNull: true,
      });
      console.log(`[Migrate] Added ${tableName}.expires_at`);
    } else {
      console.log(`[Migrate] ${tableName}.expires_at already exists, skipping`);
    }

    if (!table.upgrade_type) {
      await qi.addColumn(tableName, "upgrade_type", {
        type: db.Sequelize.ENUM("permanent", "temporary"),
        allowNull: true,
      });
      console.log(`[Migrate] Added ${tableName}.upgrade_type`);
    } else {
      console.log(`[Migrate] ${tableName}.upgrade_type already exists, skipping`);
    }
  }

  console.log("[Migrate] Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("[Migrate] Failed:", err);
  process.exit(1);
});
