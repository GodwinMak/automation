const express = require("express");
const router = express.Router();
const upload = require("../middlewares/uploadExcel");
const { uploadBillingFile } = require("../Controller/client_db");

router.post(
  "/upload",
  upload.single("file"),
  uploadBillingFile
);

module.exports = router;