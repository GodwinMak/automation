const { callUpgradeWorker } = require("../utils/upgradeWorkerRpc");
const { verifyToken, requirePermission } = require("../middleware/auth");
const { getAllUpgrades } = require("../Controller/upgrade");
const router = require("express").Router();

// Upgrade routes - restricted for customer_relation
router.post("/", verifyToken, requirePermission("canUpgradeCustomers"), async (req, res) => {
	try {
		const result = await callUpgradeWorker("dia", req.body);
		return res.status(result.status || 200).json(result.body);
	} catch (error) {
		console.error("[UpgradeRPC] DIA dispatch error:", error.message || error);
		return res.status(503).json({ message: "Upgrade worker unavailable" });
	}
});

router.put("/temporary/edit", verifyToken, requirePermission("canUpgradeCustomers"), async (req, res) => {
	try {
		const result = await callUpgradeWorker("dia_edit_temporary", req.body);
		return res.status(result.status || 200).json(result.body);
	} catch (error) {
		console.error("[UpgradeRPC] DIA temporary edit dispatch error:", error.message || error);
		return res.status(503).json({ message: "Upgrade worker unavailable" });
	}
});

// Combined DIA + IPT + L3VPN upgrade/downgrade history report
router.get("/history", verifyToken, requirePermission("canUpgradeCustomers"), getAllUpgrades);

module.exports = router;
