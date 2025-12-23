const express = require("express");
const router = express.Router();
const {
  saveReport,
  saveReportsBulk,
  getReports,
  getAggregatedReport,
  checkReportsExist,
  getAvailableMonths,
  deleteReports,
} = require("../Controller/percentileReport.js");
const { verifyToken, requirePermission } = require("../middleware/auth");

// 95th Report routes - restricted for customer_relation
// Save a single report
router.post("/", verifyToken, requirePermission("canView95thReport"), saveReport);

// Save multiple reports (bulk)
router.post("/bulk", verifyToken, requirePermission("canView95thReport"), saveReportsBulk);

// Get reports (with optional filters: month, reportType)
router.get("/", verifyToken, requirePermission("canView95thReport"), getReports);

// Get aggregated report for a month
router.get("/aggregated/:month", verifyToken, requirePermission("canView95thReport"), getAggregatedReport);

// Check what reports exist for a month
router.get("/check/:month", verifyToken, requirePermission("canView95thReport"), checkReportsExist);

// Get available months
router.get("/months", verifyToken, requirePermission("canView95thReport"), getAvailableMonths);

// Delete reports (for re-running)
router.delete("/", verifyToken, requirePermission("canView95thReport"), deleteReports);

module.exports = router;
