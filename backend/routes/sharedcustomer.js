
const { getAllSharedCustomers, getNbrSummary, getSharedCustomerById, updateClientDbForShared, markHighProfile } = require("../Controller/sharedcustomer");
const { verifyToken, adminOnly } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllSharedCustomers);
router.get("/nbr", getNbrSummary);
router.get("/:id", getSharedCustomerById);

// Update or create client_db for Shared customer by shared info ID
router.put("/:id/client-db", verifyToken, updateClientDbForShared);

// Admin-only: mark/unmark customer as high profile
router.patch("/:id/high-profile", verifyToken, adminOnly, markHighProfile);

module.exports = router;

