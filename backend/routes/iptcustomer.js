
const { getAllIptCustomers, getNbrSummary, getIptCustomerById, updateClientDbForIpt, markHighProfile } = require("../Controller/iptcustomer");
const { verifyToken, adminOnly } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllIptCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getIptCustomerById);

// Update or create client_db for IPT customer by IPT info ID
router.put("/:id/client-db", verifyToken, updateClientDbForIpt);

// Admin-only: mark/unmark customer as high profile
router.patch("/:id/high-profile", verifyToken, adminOnly, markHighProfile);

module.exports = router;

