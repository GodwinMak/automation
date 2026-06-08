const express = require("express");
const router = express.Router();
const {
	exportDiaCustomers,
	exportIptCustomers,
	exportSharedCustomers,
	exportL3VPNCustomers,
} = require("../Controller/export");

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

/**
 * Export L3VPN customers to Excel
 * GET /export/l3vpn?status=up&nbr=NBR001&search=customer
 */
router.get("/l3vpn", exportL3VPNCustomers);

module.exports = router;
