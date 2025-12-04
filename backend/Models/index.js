const dbConfig = require("../Config/dbConfig.js");
const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
  host: dbConfig.HOST,
  dialect: dbConfig.dialect,
  operatorsAliases: false,
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
db.users = require("./user.js")(sequelize, DataTypes);
db.configurationdata = require("./configurationdata.js")(sequelize, DataTypes);
db.upgradeinfos = require("./upgradeinfo.js")(sequelize, DataTypes);
db.client_dbs = require("./client_db")(sequelize, DataTypes);
db.favorites = require("./favorite.js")(sequelize, DataTypes);
db.uptimehistories = require("./uptimeHistory.js")(sequelize, DataTypes);
db.statusChangeHistories = require("./statusChangeHistory.js")(sequelize, DataTypes);
db.percentileReports = require("./percentileReport.js")(sequelize, DataTypes);


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
db.customerinfos.hasOne(db.client_dbs,{
  foreignKey: "network_cid",
  sourceKey: "cid",
});

db.client_dbs.belongsTo(db.customerinfos,{
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


db.sequelize
  .sync({ force: false })
  .then(() => {})
  .then(() => {
    console.log("Yes re-sync done.");
  });

module.exports = db;