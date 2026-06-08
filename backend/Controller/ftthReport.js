const db = require("../Models");
const FTTHReport = db.ftthReports;
const { Op } = db.Sequelize;
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const getUniqueKey = (row) => {
  const customerId = row["Customer ID"] || row.customerID;
  if (customerId) return `id:${customerId}`;
  const pppoe = row["PPPoE Username"] || row.pppoeusername;
  if (pppoe) return `pppoe:${pppoe}`;
  const ip = row["IP Address"] || row.ip;
  if (ip) return `ip:${ip}`;
  return null;
};
/**
 * GET /ftth-reports
 * Returns all report metadata, newest first.
 * Optional query: ?limit=N (default 90)
 */
exports.listReports = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 90, 365);
    const reports = await FTTHReport.findAll({
      order: [["reportDate", "DESC"]],
      limit,
      attributes: ["id", "reportDate", "totalExpiredChecked", "aliveWhileExpiredCount", "notInInfoCount", "createdAt"],
    });
    return res.status(200).json({ reports });
  } catch (err) {
    console.error("[FTTH Reports] List error:", err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * GET /ftth-reports/summary
 * Returns unique counts across recent reports.
 * Optional query: ?limit=N (default 90)
 */
exports.getReportSummary = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 90, 365);
    const reports = await FTTHReport.findAll({
      order: [["reportDate", "DESC"]],
      limit,
      attributes: ["id", "reportDate", "totalExpiredChecked", "filePath"],
    });

    const uniqueAlive = new Set();
    const uniqueNotInInfo = new Set();
    let totalExpiredChecked = 0;

    for (const report of reports) {
      totalExpiredChecked += report.totalExpiredChecked || 0;
      if (!report.filePath || !fs.existsSync(report.filePath)) continue;

      const wb = XLSX.readFile(report.filePath);

      const aliveSheet = wb.Sheets["Alive While Expired"];
      if (aliveSheet) {
        const rows = XLSX.utils.sheet_to_json(aliveSheet, { defval: "" });
        for (const row of rows) {
          if (row && "Note" in row) continue;
          const key = getUniqueKey(row);
          if (key) uniqueAlive.add(key);
        }
      }

      const notInInfoSheet = wb.Sheets["Not In Churn Report"];
      if (notInInfoSheet) {
        const rows = XLSX.utils.sheet_to_json(notInInfoSheet, { defval: "" });
        for (const row of rows) {
          if (row && "Note" in row) continue;
          const key = getUniqueKey(row);
          if (key) uniqueNotInInfo.add(key);
        }
      }
    }

    const avgExpiredChecked = reports.length
      ? Math.round(totalExpiredChecked / reports.length)
      : 0;

    return res.status(200).json({
      totalReports: reports.length,
      uniqueAliveWhileExpired: uniqueAlive.size,
      uniqueNotInChurnReport: uniqueNotInInfo.size,
      avgExpiredChecked,
    });
  } catch (err) {
    console.error("[FTTH Reports] Summary error:", err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * GET /ftth-reports/:id/download
 * Streams the Excel file for the given report ID.
 */
exports.downloadReport = async (req, res) => {
  try {
    const report = await FTTHReport.findByPk(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    const filePath = report.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Report file not found on disk" });
    }

    const fileName = path.basename(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("[FTTH Reports] Download error:", err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * GET /ftth-reports/:id/customers
 * Reads the saved Excel file and returns the flagged customers
 * from the "Alive While Expired" and "Not In Churn Report" sheets as JSON.
 */
exports.getReportCustomers = async (req, res) => {
  try {
    const report = await FTTHReport.findByPk(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    const filePath = report.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Report file not found on disk" });
    }

    const wb = XLSX.readFile(filePath);

    const parseSheet = (sheetName) => {
      const ws = wb.Sheets[sheetName];
      if (!ws) return [];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      // If the sheet only has a "Note" column, it means there were no records
      if (rows.length === 1 && "Note" in rows[0]) return [];
      return rows;
    };

    return res.status(200).json({
      reportDate: report.reportDate,
      aliveWhileExpired: parseSheet("Alive While Expired"),
      notInChurnReport: parseSheet("Not In Churn Report"),
    });
  } catch (err) {
    console.error("[FTTH Reports] Get customers error:", err.message);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
};
