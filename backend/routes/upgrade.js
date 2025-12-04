const {upgradeCustomer} = require("../Controller/upgrade");
const router = require("express").Router();

router.post("/", upgradeCustomer);

module.exports = router;
