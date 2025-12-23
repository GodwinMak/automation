const {
  getLast24Hours,
  getWeeklyTrend,
  getMonthlyTrend,
  getSummaryStats,
  getTypeComparison,
  triggerSnapshot,
} = require("../Controller/uptimeHistory");
const { verifyToken, requirePermission } = require("../middleware/auth");

const router = require("express").Router();

// Uptime trends routes - restricted for customer_relation
router.get("/24h", verifyToken, requirePermission("canViewUptimeTrends"), getLast24Hours);
router.get("/weekly", verifyToken, requirePermission("canViewUptimeTrends"), getWeeklyTrend);
router.get("/monthly", verifyToken, requirePermission("canViewUptimeTrends"), getMonthlyTrend);
router.get("/summary", verifyToken, requirePermission("canViewUptimeTrends"), getSummaryStats);
router.get("/comparison", verifyToken, requirePermission("canViewUptimeTrends"), getTypeComparison);
router.post("/snapshot", verifyToken, requirePermission("canViewUptimeTrends"), triggerSnapshot);

module.exports = router;
