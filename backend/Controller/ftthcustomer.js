const db = require("../Models");
const FTTHCustomer = db.ftthcustomers;
const FTTHCustomerInfo = db.ftthcustomerinfos;
const Sequelize = db.Sequelize;
const { Op } = Sequelize;
const XLSX = require("xlsx");
const fs = require("fs");

/**
 * Fixed column indices in Active-ChurnRetailReport.xlsx (merged-header layout):
 *   Row 3: "Customer ID" → col 2,  "Home Number" → col 12
 *   Row 4: "Customer Name" → col 4, "EMail Address" → col 6, "Top Up Expiry" → col 10, "Validity Period" → col 14
 * Data rows begin at index 7, with blank rows between each record.
 */
const COL = {
  CUSTOMER_ID: 2,
  CUSTOMER_NAME: 4,
  EMAIL: 6,
  TOP_UP_EXPIRY: 10,
  HOME_NUMBER: 12,
  VALIDITY: 14,
};

/** Convert an Excel serial date number or date string to a JS Date (or null). */
const parseExcelDate = (raw) => {
  if (!raw && raw !== 0) return null;
  if (typeof raw === "number") {
    // Excel date serial
    return new Date(Math.round((raw - 25569) * 86400 * 1000));
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
};

/** Notify all customer_relation users about a list of customers. */
const notifyCustomerRelation = async (subject, records) => {
  if (!records.length) return;
  try {
    const User = db.users;
    const Notification = db.notifications;
    const crUsers = await User.findAll({ where: { role: "customer_relation", isActive: true } });
    if (!crUsers.length) return;

    const notifs = [];
    for (const cr of crUsers) {
      for (const rec of records) {
        notifs.push({
          userId: cr.id,
          customerId: rec.customerID || "N/A",
          customerName: rec.customerName || "Unknown",
          customerType: "FTTH",
          message: subject(rec),
          isRead: false,
        });
      }
    }
    await Notification.bulkCreate(notifs);
  } catch (err) {
    console.error("[FTTH Notify] Failed to create notifications:", err.message);
  }
};

exports.getAllFTTHCustomers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const expiryFilter = req.query.expiry || "";
  const withinDays = parseInt(req.query.withinDays) || 0;
  const ipVersionFilter = req.query.ip_version || "";

  try {
    const whereClause = {};

    if (searchQuery) {
      whereClause[Sequelize.Op.or] = [
        { pppoeusername: { [Sequelize.Op.like]: `%${searchQuery}%` } },
        { ip: { [Sequelize.Op.like]: `%${searchQuery}%` } },
        { customerID: { [Sequelize.Op.like]: `%${searchQuery}%` } },
        { customerName: { [Sequelize.Op.like]: `%${searchQuery}%` } },
      ];
    }

    if (statusFilter && statusFilter !== "all") {
      whereClause.status = statusFilter;
    }

    if (ipVersionFilter === "IPv4" || ipVersionFilter === "IPv6") {
      whereClause.ip_version = ipVersionFilter;
    }

    if (withinDays > 0) {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const past = new Date(startOfToday.getTime() - withinDays * 24 * 60 * 60 * 1000);
      const future = new Date(startOfToday.getTime() + withinDays * 24 * 60 * 60 * 1000);
      if (expiryFilter === "expired") {
        // expired strictly before today, within last N days
        whereClause.topUpExpiry = { [Op.gte]: past, [Op.lt]: startOfToday };
      } else if (expiryFilter === "active") {
        // expiring today or within the next N days
        whereClause.topUpExpiry = { [Op.gte]: startOfToday, [Op.lte]: future };
      } else {
        // All: N days before and after today
        whereClause.topUpExpiry = { [Op.gte]: past, [Op.lte]: future };
      }
    } else if (expiryFilter === "expired") {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      whereClause.topUpExpiry = { [Op.lt]: startOfToday };
    } else if (expiryFilter === "active") {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      whereClause.topUpExpiry = { [Op.gte]: startOfToday };
    } else if (expiryFilter === "unavailable") {
      whereClause.topUpExpiry = { [Op.is]: null };
    } else if (expiryFilter === "within30" || expiryFilter === "within60") {
      const days = expiryFilter === "within30" ? 30 : 60;
      const now = new Date();
      const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      whereClause.topUpExpiry = { [Op.gte]: now, [Op.lte]: future };
    }

    const { count, rows } = await FTTHCustomer.findAndCountAll({
      offset,
      limit: pageSize,
      where: whereClause,
      order: [["pppoeusername", "ASC"]],
    });

    const totalPages = Math.ceil(count / pageSize);

    res.status(200).json({
      customers: rows,
      totalItems: count,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching FTTH customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.exportFTTHCustomers = async (req, res) => {
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const expiryFilter = req.query.expiry || "";
  const withinDays = parseInt(req.query.withinDays) || 0;
  const ipVersionFilter = req.query.ip_version || "";

  try {
    const whereClause = {};

    if (searchQuery) {
      whereClause[Sequelize.Op.or] = [
        { pppoeusername: { [Op.like]: `%${searchQuery}%` } },
        { ip: { [Op.like]: `%${searchQuery}%` } },
        { customerID: { [Op.like]: `%${searchQuery}%` } },
        { customerName: { [Op.like]: `%${searchQuery}%` } },
      ];
    }

    if (statusFilter && statusFilter !== "all") {
      whereClause.status = statusFilter;
    }

    if (ipVersionFilter === "IPv4" || ipVersionFilter === "IPv6") {
      whereClause.ip_version = ipVersionFilter;
    }

    if (withinDays > 0) {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const past = new Date(startOfToday.getTime() - withinDays * 24 * 60 * 60 * 1000);
      const future = new Date(startOfToday.getTime() + withinDays * 24 * 60 * 60 * 1000);
      if (expiryFilter === "expired") {
        whereClause.topUpExpiry = { [Op.gte]: past, [Op.lt]: startOfToday };
      } else if (expiryFilter === "active") {
        whereClause.topUpExpiry = { [Op.gte]: startOfToday, [Op.lte]: future };
      } else {
        // All: N days before and after today
        whereClause.topUpExpiry = { [Op.gte]: past, [Op.lte]: future };
      }
    } else if (expiryFilter === "expired") {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      whereClause.topUpExpiry = { [Op.lt]: startOfToday };
    } else if (expiryFilter === "active") {
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      whereClause.topUpExpiry = { [Op.gte]: startOfToday };
    } else if (expiryFilter === "unavailable") {
      whereClause.topUpExpiry = { [Op.is]: null };
    }

    const rows = await FTTHCustomer.findAll({
      where: whereClause,
      order: [["pppoeusername", "ASC"]],
      attributes: ["customerID", "customerName", "pppoeusername", "ip", "ip_version", "status", "homeNumber", "topUpExpiry", "isExpired", "isAliveWhileExpired", "isFreeCustomer", "notInInfo", "lastPingedAt"],
    });

    const sheetData = rows.map((r) => ({
      "Customer ID": r.customerID || "",
      "Customer Name": r.customerName || "",
      "PPPoE Username": r.pppoeusername || "",
      "IP Address": r.ip || "",
      "IP Version": r.ip_version || "",
      "Status": r.status || "",
      "Home Number": r.homeNumber || "",
      "Top Up Expiry": r.topUpExpiry ? new Date(r.topUpExpiry).toISOString().split("T")[0] : "",
      "Is Expired": r.isExpired ? "Yes" : "No",
      "Alive While Expired": r.isAliveWhileExpired ? "Yes" : "No",
      "Free Customer": r.isFreeCustomer ? "Yes" : "No",
      "Not in Churn Report": r.notInInfo ? "Yes" : "No",
      "Last Pinged At": r.lastPingedAt ? new Date(r.lastPingedAt).toISOString().replace("T", " ").split(".")[0] : "",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, "FTTH Subscribers");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `FTTH_Subscribers_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return res.send(buffer);
  } catch (error) {
    console.error("Error exporting FTTH customers:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getFTTHCustomerById = async (req, res) => {
  const { id } = req.params;

  try {
    const customer = await FTTHCustomer.findByPk(id);

    if (!customer) {
      return res.status(404).json({ message: "FTTH customer not found" });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching FTTH customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * POST /ftthcustomers/upload
 * Upload an Excel file with columns: "Customer ID", "Customer Name", "PPP User Name"
 * Matches PPP User Name → pppoeusername and updates records missing customerID / customerName.
 * This is the original upload — it updates the ftthcustomer table only.
 */
exports.uploadFTTHCustomerData = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    fs.unlink(req.file.path, () => {});

    // Find real header row
    const headerRowIndex = rawRows.findIndex((row) =>
      row.some((cell) => String(cell).trim() === "Customer ID")
    );
    if (headerRowIndex === -1) {
      return res.status(400).json({ message: 'Could not find a header row with "Customer ID" column' });
    }

    const headerRow = rawRows[headerRowIndex].map((c) => String(c).trim());
    const colCustomerID = headerRow.indexOf("Customer ID");
    const colCustomerName = headerRow.indexOf("Customer Name");
    const colPPPUser = headerRow.indexOf("PPP User Name");

    if (colPPPUser === -1) {
      return res.status(400).json({ message: 'Missing "PPP User Name" column' });
    }

    // Build lookup map: pppoeusername → { customerID, customerName }
    // De-duplicate customerIDs — if the same customerID appears for multiple
    // PPPoE usernames in the Excel, only the first mapping wins.
    const excelMap = new Map();         // pppoeusername (lowercase) → { customerID, customerName }
    const seenCustomerIDs = new Set(); // guard against duplicate customerIDs in the Excel
    for (const row of rawRows.slice(headerRowIndex + 1)) {
      const pppUser = String(row[colPPPUser] || "").trim().toLowerCase();
      if (!pppUser) continue;
      const customerID = colCustomerID !== -1 ? String(row[colCustomerID] || "").trim() : "";
      // Skip if this customerID has already been claimed by another pppoeusername in this file
      if (customerID && seenCustomerIDs.has(customerID)) continue;
      if (customerID) seenCustomerIDs.add(customerID);
      if (!excelMap.has(pppUser)) {
        excelMap.set(pppUser, {
          customerID,
          customerName: colCustomerName !== -1 ? String(row[colCustomerName] || "").trim() : "",
        });
      }
    }

    // Pre-fetch all customerIDs that are already assigned in the DB (on any record).
    // This prevents a unique-constraint violation when a customerID in the Excel
    // is already owned by a different pppoeusername in the database.
    const existingCustomerIDRows = await FTTHCustomer.findAll({
      attributes: ["customerID"],
      where: { customerID: { [Op.not]: null, [Op.ne]: "" } },
    });
    const takenCustomerIDs = new Set(existingCustomerIDRows.map((r) => r.customerID));

    // Fetch only DB records that are missing customerID OR customerName
    const missingRecords = await FTTHCustomer.findAll({
      where: {
        [Op.or]: [
          { customerID: null },
          { customerID: "" },
          { customerName: null },
          { customerName: "" },
        ],
      },
    });

    let matched = 0, updated = 0, notInExcel = 0, skipped = 0, duplicateSkipped = 0;

    for (const record of missingRecords) {
      const excelRow = excelMap.get((record.pppoeusername || "").toLowerCase());
      if (!excelRow) { notInExcel++; continue; }
      matched++;
      const updates = {};
      if (!record.customerID && excelRow.customerID) {
        // Skip customerID if it is already owned by a different DB record
        if (takenCustomerIDs.has(excelRow.customerID)) {
          duplicateSkipped++;
          // Don't assign customerID, but still fall through to try customerName
        } else {
          updates.customerID = excelRow.customerID;
          takenCustomerIDs.add(excelRow.customerID); // reserve it for this iteration
        }
      }
      if (!record.customerName && excelRow.customerName) updates.customerName = excelRow.customerName;
      if (Object.keys(updates).length === 0) { skipped++; continue; }
      await record.update(updates);
      updated++;
    }

    return res.status(200).json({
      message: "Upload complete",
      excelRows: excelMap.size,
      dbRecordsMissingData: missingRecords.length,
      matched,
      updated,
      notInExcel,
      skipped,
      duplicateSkipped,
    });
  } catch (error) {
    console.error("Error processing FTTH upload:", error);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * POST /ftthcustomers/upload-churn
 * Upload Active-ChurnRetailReport.xlsx.
 * - Parses the fixed merged-header layout.
 * - Only processes rows whose customerID already exists in ftthcustomer.
 * - Upserts each valid row into ftthcustomerinfo.
 * - Syncs homeNumber + topUpExpiry + isExpired back onto ftthcustomer.
 * - Flags all ftthcustomer records not found in ftthcustomerinfo (notInInfo).
 * - Notifies customer_relation users about expired and untracked customers.
 */
exports.uploadFTTHChurnReport = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    fs.unlink(req.file.path, () => {});

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const stats = { parsed: 0, skippedNoCustomer: 0, upserted: 0, expired: 0, notInInfo: 0 };

    // --- 1. Parse Excel rows (data starts at index 7, blank rows between records) ---
    const excelRows = [];
    for (let i = 7; i < rawRows.length; i++) {
      const row = rawRows[i];
      const customerID = String(row[COL.CUSTOMER_ID] || "").trim();
      if (!customerID) continue; // blank row

      excelRows.push({
        customerID,
        customerName: String(row[COL.CUSTOMER_NAME] || "").trim(),
        emailAddress: String(row[COL.EMAIL] || "").trim(),
        topUpExpiry: parseExcelDate(row[COL.TOP_UP_EXPIRY]),
        homeNumber: String(row[COL.HOME_NUMBER] || "").trim(),
        validityPeriod: String(row[COL.VALIDITY] || "").trim(),
      });
      stats.parsed++;
    }

    // --- 2. Fetch all existing customerIDs from ftthcustomer (whitelist) ---
    const allFtthCustomers = await FTTHCustomer.findAll({
      attributes: ["id", "customerID", "customerName", "homeNumber"],
    });
    const ftthCustomerMap = new Map(allFtthCustomers.map((c) => [c.customerID, c]));

    // --- 3. Batch upsert valid rows into ftthcustomerinfo & collect sync data ---
    const upsertRows = [];
    const expiredCustomers = [];
    const syncUpdates = []; // { id, homeNumber, topUpExpiry, isExpired }

    for (const row of excelRows) {
      const ftthRecord = ftthCustomerMap.get(row.customerID);
      if (!ftthRecord) {
        stats.skippedNoCustomer++;
        continue;
      }

      upsertRows.push({
        customerID: row.customerID,
        customerName: row.customerName || null,
        emailAddress: row.emailAddress || null,
        topUpExpiry: row.topUpExpiry || null,
        homeNumber: row.homeNumber || null,
        validityPeriod: row.validityPeriod || null,
      });
      stats.upserted++;

      const isExpired = row.topUpExpiry ? row.topUpExpiry < startOfToday : false;
      if (isExpired) {
        expiredCustomers.push({ customerID: row.customerID, customerName: row.customerName });
        stats.expired++;
      }

      syncUpdates.push({
        id: ftthRecord.id,
        homeNumber: ftthRecord.homeNumber || row.homeNumber,
        topUpExpiry: row.topUpExpiry || ftthRecord.topUpExpiry,
        isExpired,
        isAliveWhileExpired: row.topUpExpiry ? false : undefined,
      });
    }

    // Single bulk upsert into ftthcustomerinfo
    if (upsertRows.length > 0) {
      await FTTHCustomerInfo.bulkCreate(upsertRows, {
        updateOnDuplicate: ["customerName", "emailAddress", "topUpExpiry", "homeNumber", "validityPeriod"],
      });
    }

    // Batch update ftthcustomer records grouped by shared values to minimise queries
    // Group by (isExpired, isAliveWhileExpired) to issue as few UPDATE statements as possible
    const updateGroups = new Map();
    for (const u of syncUpdates) {
      // Build a key based on the boolean flags
      const flagKey = `${u.isExpired}:${u.isAliveWhileExpired ?? "keep"}`;
      if (!updateGroups.has(flagKey)) {
        updateGroups.set(flagKey, { isExpired: u.isExpired, isAliveWhileExpired: u.isAliveWhileExpired, ids: [] });
      }
      updateGroups.get(flagKey).ids.push(u.id);
    }
    // Issue one UPDATE per distinct flag combination
    await Promise.all(
      Array.from(updateGroups.values()).map((group) => {
        const updateFields = { isExpired: group.isExpired };
        if (group.isAliveWhileExpired !== undefined) {
          updateFields.isAliveWhileExpired = group.isAliveWhileExpired;
        }
        return FTTHCustomer.update(updateFields, { where: { id: group.ids } });
      })
    );

    // --- 4. Flag ftthcustomer records not present in ftthcustomerinfo ---
    const allInfoCustomerIDs = new Set(
      (await FTTHCustomerInfo.findAll({ attributes: ["customerID"] })).map((r) => r.customerID)
    );

    const notInInfoRecords = allFtthCustomers.filter(
      (c) => c.customerID && !allInfoCustomerIDs.has(c.customerID)
    );

    if (notInInfoRecords.length) {
      const ids = notInInfoRecords.map((c) => c.customerID);
      await FTTHCustomer.update(
        { notInInfo: true },
        { where: { customerID: ids } }
      );
      stats.notInInfo = notInInfoRecords.length;

      await notifyCustomerRelation(
        (rec) =>
          `FTTH customer ${rec.customerName || rec.customerID} exists in the network but has no record in the churn report. Please verify: free customer, bypass, or upload is outdated.`,
        notInInfoRecords.map((c) => ({ customerID: c.customerID, customerName: c.customerName }))
      );
    }

    // Also clear notInInfo flag for records that ARE now in ftthcustomerinfo
    if (allInfoCustomerIDs.size) {
      await FTTHCustomer.update(
        { notInInfo: false },
        { where: { customerID: Array.from(allInfoCustomerIDs) } }
      );
    }

    // --- 5. Notify customer_relation about newly expired customers ---
    if (expiredCustomers.length) {
      await notifyCustomerRelation(
        (rec) =>
          `FTTH customer ${rec.customerName || rec.customerID} service has expired (Top-Up Expiry passed). Please contact the customer for renewal.`,
        expiredCustomers
      );
    }

    return res.status(200).json({
      message: "Churn report uploaded and processed successfully",
      stats,
    });
  } catch (error) {
    console.error("[FTTH Upload] Error:", error);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * PATCH /ftthcustomers/:id
 * Update editable fields of an FTTH customer record.
 * Allowed fields: customerID, customerName, homeNumber, topUpExpiry, isFreeCustomer.
 * Automatically recomputes isExpired when topUpExpiry is changed.
 */
exports.updateFTTHCustomer = async (req, res) => {
  const { id } = req.params;
  try {
    const record = await FTTHCustomer.findByPk(id);
    if (!record) return res.status(404).json({ message: "FTTH customer not found" });

    const allowed = ["customerID", "customerName", "homeNumber", "topUpExpiry", "isFreeCustomer"];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key] === "" ? null : req.body[key];
      }
    }

    // If topUpExpiry is being changed, recompute isExpired (today's date is NOT expired)
    if (Object.prototype.hasOwnProperty.call(updates, "topUpExpiry")) {
      const expiry = updates.topUpExpiry ? new Date(updates.topUpExpiry) : null;
      if (expiry) {
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        updates.isExpired = expiry < startOfToday;
      } else {
        updates.isExpired = false;
      }
    }

    // If customerID is being changed, check for uniqueness
    if (updates.customerID && updates.customerID !== record.customerID) {
      const conflict = await FTTHCustomer.findOne({
        where: { customerID: updates.customerID },
      });
      if (conflict && conflict.id !== id) {
        return res.status(409).json({ message: "Customer ID is already used by another record." });
      }
    }

    await record.update(updates);
    return res.status(200).json({ message: "Customer updated successfully", customer: record });
  } catch (error) {
    console.error("Error updating FTTH customer:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * POST /ftthcustomers/mark-free/:id
 * Customer relation marks an FTTH customer as a free-service customer.
 * This stops the daily ping cron from processing them.
 */
exports.markAsFreeCustomer = async (req, res) => {
  const { id } = req.params;
  try {
    const record = await FTTHCustomer.findByPk(id);
    if (!record) return res.status(404).json({ message: "FTTH customer not found" });
    await record.update({ isFreeCustomer: true, isAliveWhileExpired: false });
    res.status(200).json({ message: "Customer marked as free-service customer." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
