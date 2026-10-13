const dbConfig = require("../Config/dbConfig.js");
const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
  host: dbConfig.HOST,
  dialect: dbConfig.dialect,
  operatorsAliases: false,
  logging: false,
  pool: {
    max: dbConfig.pool.max,
    min: dbConfig.pool.min,
    acquire: dbConfig.pool.acquire,
    idle: dbConfig.pool.idle,
  },
});

sequelize
  .authenticate()
  .then(() => {
    console.log("Connection has been established successfully.");
  })
  .catch((err) => {
    console.error("Unable to connect to the database:", err);
  });

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;


db.devices = require("./devices.js")(sequelize, DataTypes);
db.diacustomers = require("./diaCustomer.js")(sequelize, DataTypes);
db.customerinfos = require("./customerinfo.js")(sequelize, DataTypes);
db.iptcustomers = require("./iptCustomer.js")(sequelize, DataTypes);
db.iptcustomerinfos = require("./iptcustomerinfo.js")(sequelize, DataTypes);
db.sharedcustomers = require("./sharedCustomer.js")(sequelize, DataTypes);
db.sharedcustomerinfos = require("./sharedCustomerinfo.js")(sequelize, DataTypes);
db.l3vpncustomers = require("./L3VPNCustomer.js")(sequelize, DataTypes);
db.l3vpncustomerinfos = require("./L3VPNCustomerinfo.js")(sequelize, DataTypes);
db.ftthcustomers = require("./FTTHCustomer.js")(sequelize, DataTypes);
db.ftthcustomerinfos = require("./ftthcustomerinfo.js")(sequelize, DataTypes);
db.ftthReports = require("./ftthReport.js")(sequelize, DataTypes);
db.users = require("./user.js")(sequelize, DataTypes);
db.configurationdata = require("./configurationdata.js")(sequelize, DataTypes);
db.upgradeinfos = require("./upgradeinfo.js")(sequelize, DataTypes);
db.iptupgradeinfos = require("./iptupgradeinfo.js")(sequelize, DataTypes);
db.l3vpnupgradeinfos = require("./l3vpnupgradeinfo.js")(sequelize, DataTypes);
db.client_dbs = require("./client_db")(sequelize, DataTypes);
db.favorites = require("./favorite.js")(sequelize, DataTypes);
db.uptimehistories = require("./uptimeHistory.js")(sequelize, DataTypes);
db.statusChangeHistories = require("./statusChangeHistory.js")(sequelize, DataTypes);
db.statusChangeHistoriesFtth = require("./statusChangeHistoryFtth.js")(sequelize, DataTypes);
db.percentileReports = require("./percentileReport.js")(sequelize, DataTypes);
db.notifications = require("./notification.js")(sequelize, DataTypes);
db.diaOverusageReports = require("./diaOverusageReport.js")(sequelize, DataTypes);
db.pitchForUpgradeReports = require("./pitchForUpgradeReport.js")(sequelize, DataTypes);
db.switchConfiguration = require("./switchConfiguration.js")(sequelize, DataTypes);
db.isisAdjacency = require("./isisAdjacent.js")(sequelize, DataTypes);
db.isisWatchlist = require("./isisWatchlist.js")(sequelize, DataTypes);
db.push_tokens = require("./pushToken.js")(sequelize, DataTypes);
db.smsCampaigns = require("./smsCampaign.js")(sequelize, DataTypes);
db.smsDeliveryReports = require("./smsDeliveryReport.js")(sequelize, DataTypes);
db.emailCampaigns = require("./emailCampaign.js")(sequelize, DataTypes);
db.massOutageIncidents = require("./massOutageIncident.js")(sequelize, DataTypes);
db.massOutageIncidentCustomers = require("./massOutageIncidentCustomer.js")(sequelize, DataTypes);
db.cronJobRuns = require("./cronJobRun.js")(sequelize, DataTypes);
db.l2vpninterfaces = require("./l2vpnInterface.js")(sequelize, DataTypes);
db.l2vpncircuits = require("./l2vpnCircuit.js")(sequelize, DataTypes);
db.l2vpndeviceskips = require("./l2vpnDeviceSkip.js")(sequelize, DataTypes);
db.l2vpnvplsids = require("./l2vpnVplsId.js")(sequelize, DataTypes);
db.networkMaps = require("./networkMap.js")(sequelize, DataTypes);
db.networkMapNodes = require("./networkMapNode.js")(sequelize, DataTypes);
db.networkMapLinks = require("./networkMapLink.js")(sequelize, DataTypes);




// Relations
db.diacustomers.hasMany(db.customerinfos, {
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
});
db.customerinfos.belongsTo(db.diacustomers, {
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
});
db.iptcustomers.hasMany(db.iptcustomerinfos, {
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
});
db.iptcustomerinfos.belongsTo(db.iptcustomers, {
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
});

// Shared Customer Relations
db.sharedcustomers.hasMany(db.sharedcustomerinfos, {
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
});
db.sharedcustomerinfos.belongsTo(db.sharedcustomers, {
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
});

// L3VPN Customer Relations
db.l3vpncustomers.hasMany(db.l3vpncustomerinfos, {
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
});
db.l3vpncustomerinfos.belongsTo(db.l3vpncustomers, {
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
});

// FTTH Customer Relations (join on customerID)
db.ftthcustomers.hasOne(db.ftthcustomerinfos, {
  foreignKey: "customerID",
  sourceKey: "customerID",
  onDelete: "CASCADE",
});
db.ftthcustomerinfos.belongsTo(db.ftthcustomers, {
  foreignKey: "customerID",
  targetKey: "customerID",
});

// DIA Customers <-> Client DB
db.customerinfos.hasOne(db.client_dbs,{
  foreignKey: "network_cid",
  sourceKey: "cid",
});

db.client_dbs.belongsTo(db.customerinfos,{
  foreignKey: "network_cid",
  targetKey: "cid",
});

// IPT Customers <-> Client DB
db.iptcustomerinfos.hasOne(db.client_dbs, {
  foreignKey: "network_cid",
  sourceKey: "cid",
});

db.client_dbs.belongsTo(db.iptcustomerinfos, {
  foreignKey: "network_cid",
  targetKey: "cid",
});

// Shared Customers <-> Client DB
db.sharedcustomerinfos.hasOne(db.client_dbs, {
  foreignKey: "network_cid",
  sourceKey: "cid",
});

db.client_dbs.belongsTo(db.sharedcustomerinfos, {
  foreignKey: "network_cid",
  targetKey: "cid",
});

db.l3vpncustomerinfos.hasOne(db.client_dbs, {
  foreignKey: "network_cid",
  sourceKey: "cid",
});

db.client_dbs.belongsTo(db.l3vpncustomerinfos, {
  foreignKey: "network_cid",
  targetKey: "cid",
});


db.customerinfos.hasOne(db.configurationdata,{
  foreignKey: "customerinfo_id",
  sourceKey: "id",
  onDelete: "CASCADE",
})
db.configurationdata.belongsTo(db.customerinfos,{
  foreignKey: "customerinfo_id",
  targetKey: "id",
  onDelete: "CASCADE"
})

db.customerinfos.hasMany(db.upgradeinfos,{
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
})
db.upgradeinfos.belongsTo(db.customerinfos,{
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
})

db.iptcustomerinfos.hasMany(db.iptupgradeinfos,{
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
})
db.iptupgradeinfos.belongsTo(db.iptcustomerinfos,{
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
})

db.l3vpncustomerinfos.hasMany(db.l3vpnupgradeinfos,{
  foreignKey: "interface",
  sourceKey: "interface",
  onDelete: "CASCADE",
})
db.l3vpnupgradeinfos.belongsTo(db.l3vpncustomerinfos,{
  foreignKey: "interface",
  targetKey: "interface",
  onDelete: "CASCADE",
})

// User <-> Notifications
db.users.hasMany(db.notifications, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});
db.notifications.belongsTo(db.users, {
  foreignKey: "userId",
});

// User <-> Favorites (watchlist)
db.users.hasMany(db.favorites, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});
db.favorites.belongsTo(db.users, {
  foreignKey: "userId",
});

// Devices <-> Switch Configurations
db.devices.hasMany(db.switchConfiguration, {
  foreignKey: "deviceId",
  onDelete: "CASCADE",
});
db.switchConfiguration.belongsTo(db.devices, {
  foreignKey: "deviceId",
});

db.devices.hasMany(db.isisAdjacency, {
  foreignKey: "local_device_id",
  onDelete: "CASCADE",
});
db.isisAdjacency.belongsTo(db.devices, {
  foreignKey: "local_device_id",
});

// User <-> ISIS Watch List
db.users.hasMany(db.isisWatchlist, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});
db.isisWatchlist.belongsTo(db.users, {
  foreignKey: "userId",
});

db.users.hasMany(db.push_tokens, { foreignKey: "user_id" });
db.push_tokens.belongsTo(db.users, { foreignKey: "user_id" });

// Mass Outage Incident <-> Members
db.massOutageIncidents.hasMany(db.massOutageIncidentCustomers, {
  foreignKey: "incidentId",
  as: "members",
  onDelete: "CASCADE",
});
db.massOutageIncidentCustomers.belongsTo(db.massOutageIncidents, {
  foreignKey: "incidentId",
  as: "incident",
});

// SMS Campaign <-> per-recipient Delivery Reports
db.smsCampaigns.hasMany(db.smsDeliveryReports, {
  foreignKey: "campaignId",
  as: "deliveryReports",
  onDelete: "CASCADE",
});
db.smsDeliveryReports.belongsTo(db.smsCampaigns, {
  foreignKey: "campaignId",
  as: "campaign",
});

// L2VPN Interface <-> Devices
db.devices.hasMany(db.l2vpninterfaces, {
  foreignKey: "deviceId",
  onDelete: "CASCADE",
});
db.l2vpninterfaces.belongsTo(db.devices, {
  foreignKey: "deviceId",
});

// L2VPN Interface <-> Circuit detail
db.l2vpninterfaces.hasOne(db.l2vpncircuits, {
  foreignKey: "l2vpnInterfaceId",
  onDelete: "CASCADE",
});
db.l2vpncircuits.belongsTo(db.l2vpninterfaces, {
  foreignKey: "l2vpnInterfaceId",
});

// L2VPN Device skip cache (6-hour "no L2VPN customers" cooldown)
db.devices.hasOne(db.l2vpndeviceskips, {
  foreignKey: "deviceId",
  onDelete: "CASCADE",
});
db.l2vpndeviceskips.belongsTo(db.devices, {
  foreignKey: "deviceId",
});

// L2VPN VPLS mesh-group vpls-ids known on a PE device
db.devices.hasMany(db.l2vpnvplsids, {
  foreignKey: "deviceId",
  onDelete: "CASCADE",
});
db.l2vpnvplsids.belongsTo(db.devices, {
  foreignKey: "deviceId",
});

// Admin-curated Network Maps
db.networkMaps.hasMany(db.networkMapNodes, {
  foreignKey: "mapId",
  onDelete: "CASCADE",
  as: "nodes",
});
db.networkMapNodes.belongsTo(db.networkMaps, {
  foreignKey: "mapId",
});

db.networkMaps.hasMany(db.networkMapLinks, {
  foreignKey: "mapId",
  onDelete: "CASCADE",
  as: "links",
});
db.networkMapLinks.belongsTo(db.networkMaps, {
  foreignKey: "mapId",
});

db.users.hasMany(db.networkMaps, {
  foreignKey: "createdBy",
});
db.networkMaps.belongsTo(db.users, {
  foreignKey: "createdBy",
  as: "creator",
});

db.sequelize
  .sync({ force: false })
  .then(() => {
    console.log("Yes re-sync done.");
  })
  .catch((err) => {
    // Models/index.js is required by every process (server.js AND every
    // cron-worker fork via cron-runner.js) — before this catch existed, any
    // sync failure here (e.g. a model index whose auto-generated name
    // exceeds MySQL's 64-char identifier limit) became an unhandled promise
    // rejection, which crashes the entire process under Node's default
    // behavior. Logging instead of crashing means one bad model definition
    // can't take down the whole app; the rest of sync (and the app) still
    // runs against whatever schema state already exists.
    console.error("[Models] sequelize.sync() failed:", err.message);
  });

module.exports = db;