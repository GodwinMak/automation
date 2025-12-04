const router = require("express").Router();
const {getStatusCounts, getCustomerInfoByUpgradeType} = require("../Controller/status");

router.get("/", getStatusCounts);
router.get("/customer-info/:upgradeType", getCustomerInfoByUpgradeType);

module.exports = router;
