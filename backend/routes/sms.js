const router = require("express").Router();
const { verifyToken } = require("../middleware/auth");
const { sendBulkSms, previewRecipients, getCampaigns, getDeliveryReport } = require("../Controller/sms");

router.get("/preview", verifyToken, previewRecipients);
router.post("/send", verifyToken, sendBulkSms);
router.get("/campaigns", verifyToken, getCampaigns);
router.get("/campaigns/:id/delivery-report", verifyToken, getDeliveryReport);

module.exports = router;
