const express = require("express");
const router = express.Router();
const upload = require("../middlewares/uploadExcel");
const { 
  uploadBillingFile,
  getByCid,
  updateClientDb,
  createClientDb,
  deleteClientDb,
  getAllClientDb
} = require("../Controller/client_db");
const { verifyToken } = require("../middleware/auth");

// Upload Excel file (bulk import)
router.post("/upload", upload.single("file"), uploadBillingFile);

// Get all client_db records (with pagination)
router.get("/", verifyToken, getAllClientDb);

// Get client_db by CID
router.get("/:cid", verifyToken, getByCid);

// Create new client_db record
router.post("/", verifyToken, createClientDb);

// Update client_db by CID (upsert - creates if doesn't exist)
router.put("/:cid", verifyToken, updateClientDb);

// Delete client_db by CID
router.delete("/:cid", verifyToken, deleteClientDb);

module.exports = router;