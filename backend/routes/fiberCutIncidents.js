const express = require("express");
const router = express.Router();
const {
  getIncidents,
  getIncidentDetail,
  getIncidentSummary,
  closeIncident,
} = require("../Controller/fiberCutIncidents");
const { verifyToken, requirePermission, adminOrOperator } = require("../middleware/auth");

router.get("/", verifyToken, requirePermission("canViewChurnAnalysis"), getIncidents);
router.get("/summary", verifyToken, requirePermission("canViewChurnAnalysis"), getIncidentSummary);
router.get("/:id", verifyToken, requirePermission("canViewChurnAnalysis"), getIncidentDetail);
router.patch("/:id/close", verifyToken, adminOrOperator, closeIncident);

module.exports = router;
