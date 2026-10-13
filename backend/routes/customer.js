
const {getAllCustomers, getNbrSummary, getCustomerById, getCustomerByInterface, updateClientDbForDia, markHighProfile} = require("../Controller/customer");
const { verifyToken, adminOnly } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllCustomers);
router.get("/nbr", getNbrSummary);
router.get("/by-interface/:interface", getCustomerByInterface);
router.get("/:id", getCustomerById);

// Update or create client_db for DIA customer by customer info ID
router.put("/:id/client-db", verifyToken, updateClientDbForDia);

// Admin-only: mark/unmark customer as high profile
router.patch("/:id/high-profile", verifyToken, adminOnly, markHighProfile);

module.exports = router;
