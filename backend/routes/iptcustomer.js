
const { getAllIptCustomers, getNbrSummary, getIptCustomerById, updateClientDbForIpt } = require("../Controller/iptcustomer");
const { verifyToken } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllIptCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getIptCustomerById);

// Update or create client_db for IPT customer by IPT info ID
router.put("/:id/client-db", verifyToken, updateClientDbForIpt);

module.exports = router;

