
const {getAllCustomers, getNbrSummary, getCustomerById, getCustomerByInterface, updateClientDbForDia} = require("../Controller/customer");
const { verifyToken } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllCustomers);
router.get("/nbr", getNbrSummary);
router.get("/by-interface/:interface", getCustomerByInterface);
router.get("/:id", getCustomerById);

// Update or create client_db for DIA customer by customer info ID
router.put("/:id/client-db", verifyToken, updateClientDbForDia);

module.exports = router;
