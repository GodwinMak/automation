const {getAllCustomers, getNbrSummary, getCustomerById} = require("../Controller/customer");
const router = require("express").Router();

router.get("/", getAllCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getCustomerById);

module.exports = router;
