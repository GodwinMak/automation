const { getAllIptCustomers, getNbrSummary, getIptCustomerById } = require("../Controller/iptcustomer");
const router = require("express").Router();

router.get("/", getAllIptCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getIptCustomerById);

module.exports = router;

