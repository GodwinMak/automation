const { globalSearch } = require("../Controller/search");
const router = require("express").Router();

router.get("/", globalSearch);

module.exports = router;

