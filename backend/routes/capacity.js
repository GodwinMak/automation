const { getCapacitySummary, getCapacityStats, getTopSwitches } = require("../Controller/capacity");
const router = require("express").Router();

router.get("/", getCapacitySummary);
router.get("/stats", getCapacityStats);
router.get("/top", getTopSwitches);

module.exports = router;

