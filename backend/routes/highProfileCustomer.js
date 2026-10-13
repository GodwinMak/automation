const { getHighProfileCustomers } = require("../Controller/highProfileCustomer");
const router = require("express").Router();

router.get("/", getHighProfileCustomers);

module.exports = router;
