const {
  getAllFTTHCustomers,
  getFTTHCustomerById,
  exportFTTHCustomers,
  uploadFTTHCustomerData,
  uploadFTTHChurnReport,
  markAsFreeCustomer,
  updateFTTHCustomer,
} = require("../Controller/ftthcustomer");
const router = require("express").Router();
const upload = require("../middlewares/uploadExcel");
const { verifyToken } = require("../middleware/auth");

router.get("/", getAllFTTHCustomers);
router.get("/export", exportFTTHCustomers);
router.get("/:id", getFTTHCustomerById);

// Original upload: matches PPP User Name → updates ftthcustomer (customerID / customerName)
router.post("/upload", verifyToken, upload.single("file"), uploadFTTHCustomerData);

// New upload: Active-ChurnRetailReport.xlsx → populates ftthcustomerinfo + syncs flags
router.post("/upload-churn", verifyToken, upload.single("file"), uploadFTTHChurnReport);

// Customer relation marks a customer as free-service (stops daily pinging)
router.patch("/:id/mark-free", verifyToken, markAsFreeCustomer);

// Update editable customer fields
router.patch("/:id", verifyToken, updateFTTHCustomer);

module.exports = router;
