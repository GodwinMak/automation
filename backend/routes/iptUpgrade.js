const { callUpgradeWorker } = require("../utils/upgradeWorkerRpc");
const { verifyToken, requirePermission } = require("../middleware/auth");
const router = require("express").Router();

// Upgrade routes - mirrors routes/upgrade.js (DIA), same permission
router.post("/", verifyToken, requirePermission("canUpgradeCustomers"), async (req, res) => {
	try {
		const result = await callUpgradeWorker("ipt", req.body);
		return res.status(result.status || 200).json(result.body);
	} catch (error) {
		console.error("[UpgradeRPC] IPT dispatch error:", error.message || error);
		return res.status(503).json({ message: "Upgrade worker unavailable" });
	}
});

router.put("/temporary/edit", verifyToken, requirePermission("canUpgradeCustomers"), async (req, res) => {
	try {
		const result = await callUpgradeWorker("ipt_edit_temporary", req.body);
		return res.status(result.status || 200).json(result.body);
	} catch (error) {
		console.error("[UpgradeRPC] IPT temporary edit dispatch error:", error.message || error);
		return res.status(503).json({ message: "Upgrade worker unavailable" });
	}
});

module.exports = router;
