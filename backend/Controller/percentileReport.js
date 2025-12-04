const db = require("../Models/index.js");
const PercentileReport = db.percentileReports;
const { Op, fn, col } = require("sequelize");

// Save or update a single report
const saveReport = async (req, res) => {
  try {
    const {
      reportType,
      month,
      customerId,
      customerName,
      nbr,
      port,
      switchName,
      interface: interfaceName,
      capacity,
      p95Sent,
      p95Recv,
      p95Combined,
      displayUnit,
      dataSource,
      samples,
      usedSwitch,
      status,
      errorMessage,
    } = req.body;

    const finalCustomerId = customerId || (reportType === "GPON" ? "GPON" : null);

    // Check if record already exists
    const existing = await PercentileReport.findOne({
      where: {
        reportType,
        month,
        customerId: finalCustomerId,
      },
    });

    let report;
    let action;

    if (existing) {
      // Update existing record
      await existing.update({
        customerName,
        nbr,
        port,
        switchName,
        interface: interfaceName,
        capacity,
        p95Sent,
        p95Recv,
        p95Combined,
        displayUnit,
        dataSource,
        samples,
        usedSwitch,
        status: status || "success",
        errorMessage,
        generatedAt: new Date(),
      });
      report = existing;
      action = "updated";
    } else {
      // Create new record
      report = await PercentileReport.create({
        reportType,
        month,
        customerId: finalCustomerId,
        customerName,
        nbr,
        port,
        switchName,
        interface: interfaceName,
        capacity,
        p95Sent,
        p95Recv,
        p95Combined,
        displayUnit,
        dataSource,
        samples,
        usedSwitch,
        status: status || "success",
        errorMessage,
        generatedAt: new Date(),
      });
      action = "created";
    }

    res.json({ success: true, report, action });
  } catch (error) {
    console.error("Error saving report:", error);
    res.status(500).json({ error: error.message });
  }
};

// Save multiple reports (bulk) - updates existing or creates new
const saveReportsBulk = async (req, res) => {
  try {
    const { reports } = req.body;

    if (!reports || !Array.isArray(reports)) {
      return res.status(400).json({ error: "Reports array required" });
    }

    const results = [];
    let updated = 0;
    let created = 0;

    for (const report of reports) {
      try {
        const customerId = report.customerId || (report.reportType === "GPON" ? "GPON" : null);
        
        // Check if record already exists
        const existing = await PercentileReport.findOne({
          where: {
            reportType: report.reportType,
            month: report.month,
            customerId: customerId,
          },
        });

        if (existing) {
          // Update existing record
          await existing.update({
            customerName: report.customerName,
            nbr: report.nbr,
            port: report.port,
            switchName: report.switchName,
            interface: report.interface,
            capacity: report.capacity,
            p95Sent: report.p95Sent,
            p95Recv: report.p95Recv,
            p95Combined: report.p95Combined,
            displayUnit: report.displayUnit,
            dataSource: report.dataSource,
            samples: report.samples,
            usedSwitch: report.usedSwitch,
            status: report.status || "success",
            errorMessage: report.errorMessage,
            generatedAt: new Date(),
          });
          results.push({ success: true, id: existing.id, action: "updated" });
          updated++;
        } else {
          // Create new record
          const newRecord = await PercentileReport.create({
            ...report,
            customerId: customerId,
            generatedAt: new Date(),
          });
          results.push({ success: true, id: newRecord.id, action: "created" });
          created++;
        }
      } catch (err) {
        results.push({ success: false, error: err.message, customerId: report.customerId });
      }
    }

    res.json({ 
      success: true, 
      results, 
      total: results.filter((r) => r.success).length,
      created,
      updated,
    });
  } catch (error) {
    console.error("Error saving reports bulk:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get reports for a specific month and type
const getReports = async (req, res) => {
  try {
    const { month, reportType } = req.query;

    const where = {};
    if (month) where.month = month;
    if (reportType) where.reportType = reportType;

    const reports = await PercentileReport.findAll({
      where,
      order: [["customerName", "ASC"]],
    });

    res.json({ reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get aggregated report for a month (combined IPT, DIA, GPON)
const getAggregatedReport = async (req, res) => {
  try {
    const { month } = req.params;

    if (!month) {
      return res.status(400).json({ error: "Month parameter required" });
    }

    // Get all successful reports for the month
    const reports = await PercentileReport.findAll({
      where: {
        month,
        status: "success",
      },
    });

    // Group by type
    const byType = {
      IPT: reports.filter((r) => r.reportType === "IPT"),
      DIA: reports.filter((r) => r.reportType === "DIA"),
      GPON: reports.filter((r) => r.reportType === "GPON"),
    };

    // Calculate aggregates for each type
    const aggregates = {};
    let totalP95Combined = 0;
    let totalCustomers = 0;

    for (const [type, typeReports] of Object.entries(byType)) {
      if (typeReports.length > 0) {
        const successReports = typeReports.filter((r) => r.p95Combined !== null);
        const sumP95 = successReports.reduce((sum, r) => sum + (r.p95Combined || 0), 0);
        
        aggregates[type] = {
          count: typeReports.length,
          successCount: successReports.length,
          totalP95Combined: sumP95,
          avgP95Combined: successReports.length > 0 ? sumP95 / successReports.length : 0,
          maxP95Combined: successReports.length > 0 ? Math.max(...successReports.map((r) => r.p95Combined || 0)) : 0,
          hasData: true,
        };

        totalP95Combined += sumP95;
        totalCustomers += successReports.length;
      } else {
        aggregates[type] = {
          count: 0,
          successCount: 0,
          totalP95Combined: 0,
          avgP95Combined: 0,
          maxP95Combined: 0,
          hasData: false,
        };
      }
    }

    // Calculate overall totals
    const overall = {
      totalCustomers,
      totalP95Combined,
      avgP95Combined: totalCustomers > 0 ? totalP95Combined / totalCustomers : 0,
    };

    // Determine what's missing
    const missing = [];
    if (!aggregates.IPT.hasData) missing.push("IPT");
    if (!aggregates.DIA.hasData) missing.push("DIA");
    if (!aggregates.GPON.hasData) missing.push("GPON");

    res.json({
      month,
      aggregates,
      overall,
      missing,
      isComplete: missing.length === 0,
    });
  } catch (error) {
    console.error("Error fetching aggregated report:", error);
    res.status(500).json({ error: error.message });
  }
};

// Check what reports exist for a month
const checkReportsExist = async (req, res) => {
  try {
    const { month } = req.params;

    const counts = await PercentileReport.findAll({
      where: { month, status: "success" },
      attributes: [
        "reportType",
        [fn("COUNT", col("id")), "count"],
      ],
      group: ["reportType"],
      raw: true,
    });

    const result = {
      month,
      IPT: { exists: false, count: 0 },
      DIA: { exists: false, count: 0 },
      GPON: { exists: false, count: 0 },
    };

    counts.forEach((c) => {
      result[c.reportType] = {
        exists: parseInt(c.count) > 0,
        count: parseInt(c.count),
      };
    });

    result.missing = [];
    if (!result.IPT.exists) result.missing.push("IPT");
    if (!result.DIA.exists) result.missing.push("DIA");
    if (!result.GPON.exists) result.missing.push("GPON");

    res.json(result);
  } catch (error) {
    console.error("Error checking reports:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get available months that have reports
const getAvailableMonths = async (req, res) => {
  try {
    const months = await PercentileReport.findAll({
      attributes: [
        "month",
        [fn("COUNT", col("id")), "count"],
      ],
      group: ["month"],
      order: [["month", "DESC"]],
      raw: true,
    });

    res.json({ months });
  } catch (error) {
    console.error("Error fetching available months:", error);
    res.status(500).json({ error: error.message });
  }
};

// Delete reports for a month and type (for re-running)
const deleteReports = async (req, res) => {
  try {
    const { month, reportType } = req.query;

    const where = {};
    if (month) where.month = month;
    if (reportType) where.reportType = reportType;

    const deleted = await PercentileReport.destroy({ where });

    res.json({ success: true, deleted });
  } catch (error) {
    console.error("Error deleting reports:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  saveReport,
  saveReportsBulk,
  getReports,
  getAggregatedReport,
  checkReportsExist,
  getAvailableMonths,
  deleteReports,
};

