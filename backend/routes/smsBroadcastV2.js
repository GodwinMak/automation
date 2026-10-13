const router = require("express").Router();
const { verifyToken } = require("../middleware/auth");
const { getSwitches, previewRecipientsV2 } = require("../Controller/smsBroadcastV2");

router.get("/switches", verifyToken, getSwitches);
router.get("/preview", verifyToken, previewRecipientsV2);

module.exports = router;
