const db = require("../Models");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { createUpgradeController } = require("../utils/upgradeControllerFactory");

module.exports = createUpgradeController({
  InfoModel: db.iptcustomerinfos,
  CustomerModel: db.iptcustomers,
  UpgradeInfoModel: db.iptupgradeinfos,
  jobKey: "ipt",
  // Sequelize's default belongsTo accessor for the "iptcustomer" model is
  // singular ("iptcustomer"); checked defensively alongside the plural form,
  // mirroring Controller/upgrade.js's ["diacustomers","diacustomer"] pattern.
  customerAssocKeys: ["iptcustomers", "iptcustomer"],
});
