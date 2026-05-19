const router = require("express").Router();
const { verifyToken, requirePermission } = require("../middleware/auth");

const { diagnosisController, getCustomerUptime, l3vpnDiagnosisController, iptDiagnosisController, ftthDiagnosisController } = require("../Controller/diagnosis");

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

// Route to handle L3VPN customer diagnosis
router.post(
  "/l3vpn",
  verifyToken,
  requirePermission("canDiagnoseCustomer"),
  l3vpnDiagnosisController
);

// Route to handle IPT customer diagnosis
router.post(
  "/ipt",
  verifyToken,
  requirePermission("canDiagnoseCustomer"),
  iptDiagnosisController
);

// Route to handle FTTH customer diagnosis
router.post(
  "/ftth",
  verifyToken,
  requirePermission("canDiagnoseCustomer"),
  ftthDiagnosisController
);

module.exports = router;
