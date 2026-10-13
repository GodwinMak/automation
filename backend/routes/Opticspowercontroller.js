const { getOpticsPower, getOpticsPowerByDevice } = require("../Controller/Opticspowercontroller");
const { verifyToken, requirePermission } = require("../middleware/auth");
const router = require("express").Router();

// Optics power routes - restricted for customer_relation
router.get("/", verifyToken, requirePermission("canViewCapacity"), getOpticsPower);
router.get("/device/:deviceId", verifyToken, requirePermission("canViewCapacity"), getOpticsPowerByDevice);

module.exports = router;