const { getAllL3VPNCustomers, getL3VPNCustomerById } = require("../Controller/l3vpncustomer");
const router = require("express").Router();

router.get("/", getAllL3VPNCustomers);
router.get("/:id", getL3VPNCustomerById);

module.exports = router;
