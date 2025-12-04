const { getAllSharedCustomers, getNbrSummary, getSharedCustomerById } = require("../Controller/sharedcustomer");
const router = require("express").Router();

router.get("/", getAllSharedCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getSharedCustomerById);

module.exports = router;

