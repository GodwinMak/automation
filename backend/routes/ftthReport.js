const { listReports, downloadReport, getReportCustomers, getReportSummary } = require("../Controller/ftthReport");
const router = require("express").Router();
const { verifyToken } = require("../middleware/auth");

router.get("/", verifyToken, listReports);
router.get("/summary", verifyToken, getReportSummary);
router.get("/:id/customers", verifyToken, getReportCustomers);
router.get("/:id/download", verifyToken, downloadReport);

module.exports = router;
