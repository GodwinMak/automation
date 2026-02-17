const router = require("express").Router();
const { verifyToken, requirePermission } = require("../middleware/auth");

const { diagnosisController, getCustomerUptime } = require("../Controller/diagnosis");

// Route to handle customer diagnosis
router.post(
  "/",
  verifyToken,
  requirePermission("canDiagnoseCustomer"),
  diagnosisController
);

// Route to calculate uptime for a specific customer based on Zabbix history
router.post(
  "/uptime",
  verifyToken,
  requirePermission("canDiagnoseCustomer"),
  getCustomerUptime
);

module.exports = router;
