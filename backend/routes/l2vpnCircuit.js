const { getAllL2VPNCircuits, getL2VPNCircuitByVcid } = require("../Controller/l2vpnCircuit");
const { markL2vpnHighProfile } = require("../Controller/l2vpnHighProfile");
const { verifyToken, adminOnly } = require("../middleware/auth");
const router = require("express").Router();

router.get("/", getAllL2VPNCircuits);
router.get("/by-vcid/:vcid", getL2VPNCircuitByVcid);
router.patch("/:id/high-profile", verifyToken, adminOnly, markL2vpnHighProfile);

module.exports = router;
