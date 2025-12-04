const db = require("../Models");
const { Op, fn, col, literal } = require("sequelize");

const UptimeHistory = db.uptimehistories;

// Get hourly data for last 24 hours
exports.getLast24Hours = async (req, res) => {
  const { type } = req.query; // DIA, IPT, Shared, ALL

  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const data = await UptimeHistory.findAll({
      where: {
        customerType: type || "ALL",
        createdAt: { [Op.gte]: yesterday },
      },
      order: [["date", "ASC"], ["hour", "ASC"]],
    });

    res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching 24h data:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get daily data for last 7 days (weekly)
exports.getWeeklyTrend = async (req, res) => {
  const { type } = req.query;

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAgoDate = weekAgo.toISOString().split('T')[0];

    // Get daily averages
    const data = await UptimeHistory.findAll({
      attributes: [
        "date",
        [fn("AVG", col("uptimePercentage")), "avgUptime"],
        [fn("AVG", col("upCount")), "avgUp"],
        [fn("AVG", col("downCount")), "avgDown"],
        [fn("AVG", col("totalCustomers")), "avgTotal"],
        [fn("AVG", col("upCapacity")), "avgUpCapacity"],
        [fn("AVG", col("totalCapacity")), "avgTotalCapacity"],
      ],
      where: {
        customerType: type || "ALL",
        date: { [Op.gte]: weekAgoDate },
      },
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true,
    });

    res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching weekly data:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get daily data for last 30 days (monthly)
exports.getMonthlyTrend = async (req, res) => {
  const { type } = req.query;

  try {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthAgoDate = monthAgo.toISOString().split('T')[0];

    // Get daily averages
    const data = await UptimeHistory.findAll({
      attributes: [
        "date",
        [fn("AVG", col("uptimePercentage")), "avgUptime"],
        [fn("AVG", col("upCount")), "avgUp"],
        [fn("AVG", col("downCount")), "avgDown"],
        [fn("AVG", col("totalCustomers")), "avgTotal"],
        [fn("AVG", col("upCapacity")), "avgUpCapacity"],
        [fn("AVG", col("totalCapacity")), "avgTotalCapacity"],
      ],
      where: {
        customerType: type || "ALL",
        date: { [Op.gte]: monthAgoDate },
      },
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true,
    });

    res.status(200).json({ data });
  } catch (error) {
    console.error("Error fetching monthly data:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get summary stats for different periods
exports.getSummaryStats = async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Today's average
    const todayStats = await UptimeHistory.findAll({
      attributes: [
        "customerType",
        [fn("AVG", col("uptimePercentage")), "avgUptime"],
      ],
      where: { date: today },
      group: ["customerType"],
      raw: true,
    });

    // Weekly average
    const weeklyStats = await UptimeHistory.findAll({
      attributes: [
        "customerType",
        [fn("AVG", col("uptimePercentage")), "avgUptime"],
      ],
      where: { date: { [Op.gte]: weekAgo } },
      group: ["customerType"],
      raw: true,
    });

    // Monthly average
    const monthlyStats = await UptimeHistory.findAll({
      attributes: [
        "customerType",
        [fn("AVG", col("uptimePercentage")), "avgUptime"],
      ],
      where: { date: { [Op.gte]: monthAgo } },
      group: ["customerType"],
      raw: true,
    });

    // Format response
    const formatStats = (arr) => {
      const result = { DIA: 0, IPT: 0, Shared: 0, ALL: 0 };
      arr.forEach((item) => {
        result[item.customerType] = parseFloat(item.avgUptime || 0).toFixed(2);
      });
      return result;
    };

    res.status(200).json({
      today: formatStats(todayStats),
      weekly: formatStats(weeklyStats),
      monthly: formatStats(monthlyStats),
    });
  } catch (error) {
    console.error("Error fetching summary stats:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get comparison between types
exports.getTypeComparison = async (req, res) => {
  const { period } = req.query; // 24h, weekly, monthly

  try {
    const now = new Date();
    let startDate;

    switch (period) {
      case "24h":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "weekly":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const startDateStr = startDate.toISOString().split('T')[0];

    const data = await UptimeHistory.findAll({
      attributes: [
        "customerType",
        [fn("AVG", col("uptimePercentage")), "avgUptime"],
        [fn("MIN", col("uptimePercentage")), "minUptime"],
        [fn("MAX", col("uptimePercentage")), "maxUptime"],
        [fn("AVG", col("upCount")), "avgUp"],
        [fn("AVG", col("downCount")), "avgDown"],
        [fn("AVG", col("upCapacity")), "avgUpCapacity"],
        [fn("AVG", col("totalCapacity")), "avgTotalCapacity"],
      ],
      where: {
        date: { [Op.gte]: startDateStr },
        customerType: { [Op.ne]: "ALL" },
      },
      group: ["customerType"],
      raw: true,
    });

    res.status(200).json({ data, period });
  } catch (error) {
    console.error("Error fetching type comparison:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Manual snapshot trigger
exports.triggerSnapshot = async (req, res) => {
  try {
    const { recordSnapshot } = require("../cron/uptimeTracker");
    await recordSnapshot();
    res.status(200).json({ message: "Snapshot recorded successfully" });
  } catch (error) {
    console.error("Error triggering snapshot:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

