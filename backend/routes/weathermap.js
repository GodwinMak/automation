const router = require("express").Router();
const { getWeathermapTopology } = require("../Controller/weathermap");

router.get("/topology", getWeathermapTopology);

module.exports = router;
