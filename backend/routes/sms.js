const router = require("express").Router();
const { verifyToken } = require("../middleware/auth");
const upload = require("../middlewares/uploadExcel");
const {
  sendBulkSms,
  previewRecipients,
  getCampaigns,
  getDeliveryReport,
  getFullDeliveryReport,
  selectRecipientsFromFile,
} = require("../Controller/sms");

router.get("/preview", verifyToken, previewRecipients);
router.post("/send", verifyToken, sendBulkSms);
router.post("/select-from-file", verifyToken, upload.single("file"), selectRecipientsFromFile);
router.get("/campaigns", verifyToken, getCampaigns);
router.get("/campaigns/:id/delivery-report", verifyToken, getDeliveryReport);
router.get("/campaigns/:id/delivery-report/full", verifyToken, getFullDeliveryReport);

module.exports = router;
