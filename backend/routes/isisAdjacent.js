const router = require("express").Router();
const {getTopology, getImpactData} = require("../Controller/isisAdjacent")

router.get("/topology", getTopology);
router.get("/impact-data", getImpactData);

module.exports = router;