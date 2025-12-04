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

// Get all status changes with filtering and pagination
router.get("/changes", getStatusChanges);

// Get customers with frequent status changes (unstable/at risk)
router.get("/unstable", getUnstableCustomers);

// Get customers currently down for extended periods
router.get("/extended-downtime", getExtendedDowntimeCustomers);

// Get summary statistics for churn analysis
router.get("/summary", getChurnSummary);

// Get pattern analysis (hourly/daily trends)
router.get("/patterns", getPatternAnalysis);

// Get status history for a specific customer
router.get("/customer/:interface", getCustomerHistory);
router.get("/customer/:interface/:customerType", getCustomerHistory);

module.exports = router;

