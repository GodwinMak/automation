/**
 * One-off: adds the SMS notification-preferences columns/table introduced
 * for the Settings -> Notifications feature. Models/index.js runs
 * sync({ force: false }) on every boot, which does not add columns to a
 * table that already exists, so this needs to run once against the live DB.
 *
 * Usage (from backend/): node scripts/addSmsPreferenceColumns.js
 */
const db = require("../Models");

const run = async () => {
  await db.sequelize.authenticate();
  const qi = db.sequelize.getQueryInterface();

  // --- users ---
  const usersTable = await qi.describeTable("users");

  const isFirstRun = !usersTable.highTrafficSmsEnabled;

  if (!usersTable.highTrafficSmsEnabled) {
    await qi.addColumn("users", "highTrafficSmsEnabled", {
      type: db.Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    console.log("[Migrate] Added users.highTrafficSmsEnabled");
  } else {
    console.log("[Migrate] users.highTrafficSmsEnabled already exists, skipping");
  }

  // Unlike canReceiveIsisSms below, highTrafficSmsEnabled is a brand-new
  // field with no prior "opt-out" history for anyone to have legitimately
  // set to false — no existing user could have configured it before this
  // migration, since the column (and the Settings toggle) didn't exist yet.
  // So unlike the guarded canReceiveIsisSms backfill, it's always safe to
  // run this unconditionally: it self-heals any row that ended up false
  // despite the column's own DEFAULT (e.g. if the column was added
  // out-of-band, by hand, before this script ran).
  await qi.bulkUpdate("users", { highTrafficSmsEnabled: true }, { highTrafficSmsEnabled: false });
  console.log("[Migrate] Ensured users.highTrafficSmsEnabled = true for any rows still false");

  if (!usersTable.isisWatchScope) {
    await qi.addColumn("users", "isisWatchScope", {
      type: db.Sequelize.ENUM("all", "watchlist"),
      allowNull: false,
      defaultValue: "all",
    });
    console.log("[Migrate] Added users.isisWatchScope");
  } else {
    console.log("[Migrate] users.isisWatchScope already exists, skipping");
  }

  // canReceiveIsisSms already exists (added by addUserSmsColumns.js) but its
  // semantics/default are changing from opt-in (false) to opt-out (true) as
  // part of this feature. Only backfill existing rows the first time this
  // script runs, so re-running it doesn't stomp an admin's later opt-out.
  if (isFirstRun) {
    await qi.bulkUpdate("users", { canReceiveIsisSms: true }, { canReceiveIsisSms: false });
    console.log("[Migrate] Backfilled users.canReceiveIsisSms = true for existing rows");
  } else {
    console.log("[Migrate] users.canReceiveIsisSms backfill already applied, skipping");
  }

  // --- favorites ---
  const favoritesTable = await qi.describeTable("favorites");
  if (!favoritesTable.smsAlertsEnabled) {
    await qi.addColumn("favorites", "smsAlertsEnabled", {
      type: db.Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    console.log("[Migrate] Added favorites.smsAlertsEnabled");
  } else {
    console.log("[Migrate] favorites.smsAlertsEnabled already exists, skipping");
  }

  // --- favorites.customerType enum ---
  // L2VPN circuits have no single customerinfos-style row (a circuit spans
  // multiple devices/hops) — they're tracked by virtualCircuitId instead
  // (see cron/updateL2VPN.js's trackL2VPNCircuitStatusChanges), which is
  // what gets stored as Favorite.customerId for an L2VPN watch-list entry.
  const currentFavoriteEnumType = favoritesTable.customerType?.type || "";
  if (!currentFavoriteEnumType.includes("L2VPN")) {
    await qi.changeColumn("favorites", "customerType", {
      type: db.Sequelize.ENUM("DIA", "IPT", "Shared", "L3VPN", "FTTH", "L2VPN"),
      allowNull: false,
    });
    console.log("[Migrate] Extended favorites.customerType enum with L2VPN");
  } else {
    console.log("[Migrate] favorites.customerType enum already up to date, skipping");
  }

  // --- notifications.customerType enum ---
  // MySQL's describeTable reports enum columns as a type string like
  // "ENUM('DIA','IPT','Shared','FTTH')" (see Sequelize's mysql/query.js),
  // not a parsed list of values, so check by substring.
  const notificationsTable = await qi.describeTable("notifications");
  const currentEnumType = notificationsTable.customerType?.type || "";
  const needsEnumUpdate =
    !currentEnumType.includes("L3VPN") ||
    !currentEnumType.includes("ISIS") ||
    !currentEnumType.includes("L2VPN");

  if (needsEnumUpdate) {
    await qi.changeColumn("notifications", "customerType", {
      type: db.Sequelize.ENUM("DIA", "IPT", "Shared", "FTTH", "L3VPN", "ISIS", "L2VPN"),
      allowNull: false,
    });
    console.log("[Migrate] Extended notifications.customerType enum with L3VPN, ISIS, L2VPN");
  } else {
    console.log("[Migrate] notifications.customerType enum already up to date, skipping");
  }

  // --- isis_watchlists table ---
  // Unlike the column additions above, this is a brand-new model/table (see
  // Models/isisWatchlist.js) with nothing to migrate — db.sequelize.sync({
  // force: false }) at the bottom of Models/index.js (which just ran, since
  // this script requires ../Models) already creates any table that doesn't
  // exist yet, unique index included, straight from the model definition.
  // It only ever skips tables/columns that already exist, which is exactly
  // why the column changes above still need this explicit script.
  const tables = await qi.showAllTables();
  console.log(
    tables.includes("isis_watchlists")
      ? "[Migrate] isis_watchlists table present (created by sequelize sync)"
      : "[Migrate] isis_watchlists table not found yet — it's created asynchronously by " +
        "sequelize sync on ../Models require; re-run this script if it's still missing."
  );

  console.log("[Migrate] Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("[Migrate] Failed:", err);
  process.exit(1);
});
