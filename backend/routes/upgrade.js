const { upgradeCustomer } = require("../Controller/upgrade");
const { verifyToken, requirePermission } = require("../middleware/auth");
const router = require("express").Router();

// Upgrade routes - restricted for customer_relation
router.post("/", verifyToken, requirePermission("canUpgradeCustomers"), upgradeCustomer);

module.exports = router;
