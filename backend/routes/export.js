const express = require("express");
const router = express.Router();
const { exportDiaCustomers, exportIptCustomers, exportSharedCustomers } = require("../Controller/export");

/**
 * Export DIA customers to Excel
 * GET /export/dia?status=up&nbr=NBR001&search=customer
 */
router.get("/dia", exportDiaCustomers);

/**
 * Export IPT customers to Excel
 * GET /export/ipt?status=up&nbr=NBR001&search=customer
 */
router.get("/ipt", exportIptCustomers);

/**
 * Export Shared customers to Excel
 * GET /export/shared?status=up&nbr=NBR001&search=customer
 */
router.get("/shared", exportSharedCustomers);

module.exports = router;
