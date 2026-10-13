const router = require("express").Router();
const { verifyToken } = require("../middleware/auth");
const { sendBulkEmail, getCampaigns } = require("../Controller/email");

router.post("/send", verifyToken, sendBulkEmail);
router.get("/campaigns", verifyToken, getCampaigns);

module.exports = router;
