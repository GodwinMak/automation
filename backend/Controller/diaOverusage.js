const db = require("../Models");
const { checkDiaOverusage } = require("../cron/diaOverusageChecker");

// Run DIA over-usage report on demand and return the freshly generated results
exports.runDiaOverusageReport = async (req, res) => {
  try {
    const results = (await checkDiaOverusage()) || [];
    return res.status(200).json({
      mode: "fresh",
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("[DIA Overusage] API error (fresh run):", error.message);
    return res.status(500).json({
      message: "Failed to run DIA over-usage report",
      error: error.message,
    });
  }
};

// Get the latest stored DIA over-usage report from the database without re-running Zabbix
exports.getDiaOverusageReport = async (req, res) => {
  try {
    const DiaOverusageReport = db.diaOverusageReports;

    const latest = await DiaOverusageReport.findAll({
      order: [["runAt", "DESC"]],
    });

    return res.status(200).json({
      mode: "cached",
      count: latest.length,
      data: latest,
    });
  } catch (error) {
    console.error("[DIA Overusage] API error (get cached):", error.message);
    return res.status(500).json({
      message: "Failed to fetch DIA over-usage report",
      error: error.message,
    });
  }
};
