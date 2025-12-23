const { getCapacitySummary, getCapacityStats, getTopSwitches } = require("../Controller/capacity");
const { verifyToken, requirePermission } = require("../middleware/auth");
const router = require("express").Router();

// Capacity routes - restricted for customer_relation
router.get("/", verifyToken, requirePermission("canViewCapacity"), getCapacitySummary);
router.get("/stats", verifyToken, requirePermission("canViewCapacity"), getCapacityStats);
router.get("/top", verifyToken, requirePermission("canViewCapacity"), getTopSwitches);

module.exports = router;
