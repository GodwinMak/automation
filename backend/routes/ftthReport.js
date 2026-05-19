const { listReports, downloadReport, getReportCustomers } = require("../Controller/ftthReport");
const router = require("express").Router();
const { verifyToken } = require("../middleware/auth");

router.get("/", verifyToken, listReports);
router.get("/:id/customers", verifyToken, getReportCustomers);
router.get("/:id/download", verifyToken, downloadReport);

module.exports = router;
