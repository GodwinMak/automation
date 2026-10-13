const router = require("express").Router();
const { getTopology, getImpactData, getAdjacencyList, getBlackboxTargets, getPtpInfoMetrics, getPingMonitor } = require("../Controller/isisAdjacent");
const { verifyToken, requirePermission } = require("../middleware/auth");

router.get("/topology", getTopology);
router.get("/impact-data", getImpactData);
router.get("/list", verifyToken, getAdjacencyList);
router.get("/blackbox-targets", getBlackboxTargets);
router.get("/ping-monitor", verifyToken, requirePermission("canViewUptimeTrends"), getPingMonitor);
router.get("/ptp-info", getPtpInfoMetrics);

module.exports = router;