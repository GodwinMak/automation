const router = require("express").Router();
const { verifyToken, requirePermission } = require("../middleware/auth");
const {
	runDiaOverusageReport,
	getDiaOverusageReport,
} = require("../Controller/diaOverusage");

// Get latest stored DIA over-usage report
router.get("/", verifyToken, requirePermission("canViewCapacity"), getDiaOverusageReport);

// Run DIA over-usage report on demand (this will also overwrite stored data)
router.post("/run", verifyToken, requirePermission("canViewCapacity"), runDiaOverusageReport);

module.exports = router;
