const router = require("express").Router();
const {getStatusCounts, getCustomerInfoByUpgradeType, getAllTemporaryUpgrades} = require("../Controller/status");

router.get("/", getStatusCounts);
router.get("/customer-info/:upgradeType", getCustomerInfoByUpgradeType);
router.get("/temporary-upgrades", getAllTemporaryUpgrades);

module.exports = router;
