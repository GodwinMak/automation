const db = require("../Models");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { createUpgradeController } = require("../utils/upgradeControllerFactory");

module.exports = createUpgradeController({
  InfoModel: db.l3vpncustomerinfos,
  CustomerModel: db.l3vpncustomers,
  UpgradeInfoModel: db.l3vpnupgradeinfos,
  jobKey: "l3vpn",
  // Sequelize's default belongsTo accessor for the "l3vpncustomer" model is
  // singular ("l3vpncustomer"); checked defensively alongside the plural
  // form, mirroring Controller/upgrade.js's ["diacustomers","diacustomer"]
  // pattern.
  customerAssocKeys: ["l3vpncustomers", "l3vpncustomer"],
});
