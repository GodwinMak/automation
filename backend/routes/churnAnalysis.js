const express = require("express");
const router = express.Router();
const {
  getStatusChanges,
  getUnstableCustomers,
  getExtendedDowntimeCustomers,
  getChurnSummary,
  getCustomerHistory,
  getPatternAnalysis,
} = require("../Controller/churnAnalysis");
const { verifyToken, requirePermission } = require("../middleware/auth");

// Churn analysis routes - restricted for customer_relation
router.get("/changes", verifyToken, requirePermission("canViewChurnAnalysis"), getStatusChanges);
router.get("/unstable", verifyToken, requirePermission("canViewChurnAnalysis"), getUnstableCustomers);
router.get("/extended-downtime", verifyToken, requirePermission("canViewChurnAnalysis"), getExtendedDowntimeCustomers);
router.get("/summary", verifyToken, requirePermission("canViewChurnAnalysis"), getChurnSummary);
router.get("/patterns", verifyToken, requirePermission("canViewChurnAnalysis"), getPatternAnalysis);
router.get("/customer/:interface", verifyToken, requirePermission("canViewChurnAnalysis"), getCustomerHistory);
router.get("/customer/:interface/:customerType", verifyToken, requirePermission("canViewChurnAnalysis"), getCustomerHistory);

module.exports = router;
