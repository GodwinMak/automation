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

// Save a single report
router.post("/", saveReport);

// Save multiple reports (bulk)
router.post("/bulk", saveReportsBulk);

// Get reports (with optional filters: month, reportType)
router.get("/", getReports);

// Get aggregated report for a month
router.get("/aggregated/:month", getAggregatedReport);

// Check what reports exist for a month
router.get("/check/:month", checkReportsExist);

// Get available months
router.get("/months", getAvailableMonths);

// Delete reports (for re-running)
router.delete("/", deleteReports);

module.exports = router;

