const { getAllL3VPNCustomers, getL3VPNCustomerById, markHighProfile } = require("../Controller/l3vpncustomer");
const { verifyToken, adminOnly } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllL3VPNCustomers);
router.get("/:id", getL3VPNCustomerById);

// Admin-only: mark/unmark customer as high profile
router.patch("/:id/high-profile", verifyToken, adminOnly, markHighProfile);

module.exports = router;
