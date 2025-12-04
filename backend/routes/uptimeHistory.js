const {
  getLast24Hours,
  getWeeklyTrend,
  getMonthlyTrend,
  getSummaryStats,
  getTypeComparison,
  triggerSnapshot,
} = require("../Controller/uptimeHistory");

const router = require("express").Router();

router.get("/24h", getLast24Hours);
router.get("/weekly", getWeeklyTrend);
router.get("/monthly", getMonthlyTrend);
router.get("/summary", getSummaryStats);
router.get("/comparison", getTypeComparison);
router.post("/snapshot", triggerSnapshot);

module.exports = router;

