const express = require("express");
const router = express.Router();
const { getJobStats } = require("../Controller/processMonitoring");
const { verifyToken, requireFlag } = require("../middleware/auth");

router.get("/", verifyToken, requireFlag("canViewProcessMonitoring"), getJobStats);

module.exports = router;
