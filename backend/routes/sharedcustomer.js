
const { getAllSharedCustomers, getNbrSummary, getSharedCustomerById, updateClientDbForShared } = require("../Controller/sharedcustomer");
const { verifyToken } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllSharedCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getSharedCustomerById);

// Update or create client_db for Shared customer by shared info ID
router.put("/:id/client-db", verifyToken, updateClientDbForShared);

module.exports = router;

