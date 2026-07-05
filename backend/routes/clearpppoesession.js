const router = require("express").Router();
const {
  clearAllUpIPV4ExpiredNotFreePppoeSession,
  clearAllUpIPV6NotExpiredPppoeSession,
  clearAllUpIPV6ExpiredPppoeSession,
  clearSpecificUpPppoeSession,
} = require("../Controller/clearpppoesession");
const { verifyToken, requirePermission } = require("../middleware/auth");

router.post("/clear-specific", verifyToken, requirePermission("canViewCapacity"), clearSpecificUpPppoeSession);
router.post(
  "/clear-all-ipv6-not-expired",
  verifyToken,
  requirePermission("canManageUsers"),
  clearAllUpIPV6NotExpiredPppoeSession,
);
router.post(
  "/clear-all-ipv6-expired",
  verifyToken,
  requirePermission("canManageUsers"),
  clearAllUpIPV6ExpiredPppoeSession,
);
router.post(
  "/clear-all-ipv4-expired-not-free",
  verifyToken,
  requirePermission("canManageUsers"),
  clearAllUpIPV4ExpiredNotFreePppoeSession,
);

module.exports = router;
