const db = require("../Models");
const axios = require("axios");
const XLSX = require("xlsx");
const fs = require("fs");

const beemAuth = () =>
  "Basic " +
  Buffer.from(
    `${process.env.BEEM_API_KEY}:${process.env.BEEM_SECRET_KEY}`
  ).toString("base64");

/**
 * Normalise a phone number to E.164 format without the leading '+'.
 * Handles (Tanzania):
 *   +255712345678  →  255712345678
 *   255712345678   →  255712345678
 *   0712345678     →  255712345678   (leading 0)
 *   712345678      →  255712345678   (9-digit, starts with 7)
 *   612345678      →  255712345678   (9-digit, starts with 6)
 * Returns null for numbers that cannot be normalised (filtered out downstream).
 */
const normalizePhone = (n) => {
  let s = String(n).replace(/[\s\-().+]/g, "");
  if (!s) return null;

  // Already has country code
  if (s.startsWith("255")) {
    return s.length === 12 ? s : null;
  }

  // Local format: 0712345678 (10 digits)
  if (s.startsWith("0") && s.length === 10) {
    return "255" + s.slice(1);
  }

  // Short format: 712345678 or 612345678 (9 digits, starts with 6 or 7)
  if ((s.startsWith("7") || s.startsWith("6")) && s.length === 9) {
    return "255" + s;
  }

  // Unknown format — keep as-is only if it looks like a plausible number (7–15 digits)
  return /^\d{7,15}$/.test(s) ? s : null;
};

/**
 * POST /sms/send
 * Body: {
 *   sendMode: "specific"|"all",
 *   customerType?: "ftth"|...,
 *   message: string,
 *   extraNumbers?: string[],
 *   specificNumbers?: string[],          // legacy — bare numbers, no customer identity
 *   specificRecipients?: {                // preferred — carries identity through to the delivery report
 *     customerId?: string,
 *     customerName?: string,
 *     customerType?: string,
 *     phoneNumber: string,
 *   }[],
 * }
 * sendMode controls whether the DB lookup is used.
 *
 * This only builds the recipient list and writes a "queued" smsCampaign
 * row — it does NOT call Beem. Actual sending happens out-of-band in
 * cron/smsSender.js (its own PM2 process, cron-worker-sms-send), so a
 * large broadcast can't tie up an automation-server request/cluster
 * worker for the whole duration of a multi-chunk send.
 */
exports.sendBulkSms = async (req, res) => {
  const { sendMode, customerType, message, extraNumbers, specificNumbers, specificRecipients } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message is required." });
  }

  if (!sendMode || (sendMode !== "specific" && sendMode !== "all")) {
    return res.status(400).json({ error: "sendMode must be 'specific' or 'all'." });
  }

  const manualNumbers = Array.isArray(extraNumbers)
    ? extraNumbers.map((n) => normalizePhone(n)).filter(Boolean)
    : [];

  try {
    // recipients: identity-carrying list built from whichever selection mode
    // was used. Later stages only work off phoneNumber, but we keep this
    // around to attach customerId/customerName/customerType to each
    // smsDeliveryReport row.
    let recipients = [];
    let customerCount = 0;

    const hasStructuredRecipients = Array.isArray(specificRecipients) && specificRecipients.length > 0;
    const hasSpecificNumbers = Array.isArray(specificNumbers) && specificNumbers.length > 0;

    if (sendMode === "specific") {
      if (!hasStructuredRecipients && !hasSpecificNumbers && manualNumbers.length === 0) {
        return res.status(400).json({ error: "specificRecipients, specificNumbers or extraNumbers is required when sendMode is 'specific'." });
      }
      if (hasStructuredRecipients) {
        recipients = specificRecipients
          .map((r) => ({
            customerId: r.customerId || null,
            customerName: r.customerName || null,
            customerType: r.customerType || customerType || null,
            phoneNumber: normalizePhone(r.phoneNumber),
          }))
          .filter((r) => r.phoneNumber);
      } else if (hasSpecificNumbers) {
        // Legacy path — bare numbers with no customer identity available.
        recipients = specificNumbers
          .map(normalizePhone)
          .filter(Boolean)
          .map((phoneNumber) => ({ customerId: null, customerName: null, customerType: customerType || null, phoneNumber }));
      }
      customerCount = recipients.length;
    } else if (sendMode === "all") {
      if (customerType !== "ftth") {
        return res.status(400).json({ error: "customerType is required when sendMode is 'all'." });
      }
      const customers = await db.ftthcustomers.findAll({
        attributes: ["customerID", "customerName", "homeNumber"],
        where: { homeNumber: { [db.Sequelize.Op.ne]: null } },
      });
      recipients = customers
        .map((c) => ({
          customerId: c.customerID || null,
          customerName: c.customerName || null,
          customerType: "FTTH",
          phoneNumber: c.homeNumber && normalizePhone(c.homeNumber),
        }))
        .filter((r) => r.phoneNumber);
      customerCount = customers.length;
    }

    // Manual/extra numbers carry no customer identity.
    for (const phoneNumber of manualNumbers) {
      recipients.push({ customerId: null, customerName: null, customerType: "manual", phoneNumber });
    }

    // De-dupe by phone number, keeping the first (most identity-complete) occurrence.
    const totalBeforeDedupe = recipients.length;
    const recipientByPhone = new Map();
    for (const r of recipients) {
      if (!recipientByPhone.has(r.phoneNumber)) recipientByPhone.set(r.phoneNumber, r);
    }
    const allNumbers = [...recipientByPhone.keys()];
    const deduplicatedCount = Math.max(0, totalBeforeDedupe - allNumbers.length);

    if (allNumbers.length === 0) {
      return res.status(200).json({
        sent: 0,
        customerCount,
        extraCount: manualNumbers.length,
        message: "No phone numbers found for the selected customer type.",
      });
    }

    // Snapshot the recipient list on the campaign row — cron/smsSender.js
    // sends to exactly this list, not a re-query of "all" at send time.
    const campaign = await db.smsCampaigns.create({
      customerType,
      message: message.trim(),
      recipients: [...recipientByPhone.values()],
      chunks: [],
      status: "queued",
      totalSent: 0,
      customerCount,
      extraCount: manualNumbers.length,
    });

    return res.status(202).json({
      campaignId: campaign.id,
      queued: allNumbers.length,
      customerCount,
      extraCount: manualNumbers.length,
      deduplicatedCount,
      message: `SMS queued for ${allNumbers.length} recipients (${manualNumbers.length} manually added). Sending in the background.`,
    });
  } catch (err) {
    console.error("[SMS Controller] Error:", err);
    return res.status(500).json({ error: "Failed to send SMS.", details: err.message });
  }
};

/**
 * GET /sms/preview?customerType=ftth
 */
exports.previewRecipients = async (req, res) => {
  const { customerType } = req.query;

  if (!customerType) {
    return res.status(400).json({ error: "customerType is required." });
  }

  try {
    if (customerType === "ftth") {
      const customers = await db.ftthcustomers.findAll({
        attributes: ["customerID", "customerName", "homeNumber"],
        where: { homeNumber: { [db.Sequelize.Op.ne]: null } },
        order: [["customerName", "ASC"]],
      });
      return res.status(200).json({ recipients: customers, total: customers.length });
    }

    return res.status(400).json({ error: `Customer type "${customerType}" is not yet supported.` });
  } catch (err) {
    console.error("[SMS Preview] Error:", err);
    return res.status(500).json({ error: "Failed to fetch recipients.", details: err.message });
  }
};

/**
 * POST /sms/select-from-file
 * Upload an Excel file with a "Customer ID" column.
 * Returns the list of customerIDs found so the frontend can match them
 * against the already-loaded recipient list and auto-select those rows.
 */
exports.selectRecipientsFromFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    fs.unlink(req.file.path, () => {});

    const headerRowIndex = rawRows.findIndex((row) =>
      row.some((cell) => String(cell).trim().toLowerCase() === "customer id")
    );
    if (headerRowIndex === -1) {
      return res.status(400).json({ error: 'Could not find a header row with a "Customer ID" column.' });
    }

    const headerRow = rawRows[headerRowIndex].map((c) => String(c).trim().toLowerCase());
    const colCustomerID = headerRow.indexOf("customer id");

    const customerIDs = [
      ...new Set(
        rawRows
          .slice(headerRowIndex + 1)
          .map((row) => String(row[colCustomerID] || "").trim())
          .filter(Boolean)
      ),
    ];

    return res.status(200).json({ customerIDs, total: customerIDs.length });
  } catch (err) {
    console.error("[SMS Select From File] Error:", err);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ error: "Failed to process file.", details: err.message });
  }
};

/**
 * GET /sms/campaigns?page=1&pageSize=20
 */
exports.getCampaigns = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
  try {
    const { count, rows } = await db.smsCampaigns.findAndCountAll({
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      attributes: ["id", "customerType", "message", "status", "errorMessage", "totalSent", "customerCount", "extraCount", "createdAt"],
    });
    return res.status(200).json({
      campaigns: rows,
      total: count,
      totalPages: Math.ceil(count / pageSize),
      page,
    });
  } catch (err) {
    console.error("[SMS Campaigns] Error:", err);
    return res.status(500).json({ error: "Failed to fetch campaigns.", details: err.message });
  }
};

/**
 * GET /sms/campaigns/:id/delivery-report
 *
 * Returns delivery stats using the valid/invalid counts saved at send time.
 * These are authoritative — Beem rejects invalid numbers immediately at submission.
 *
 * For a spot-check on a single number:
 *   GET /sms/campaigns/:id/delivery-report?dest_addr=255712345678
 */
exports.getDeliveryReport = async (req, res) => {
  const { id } = req.params;
  const { dest_addr } = req.query;

  try {
    const campaign = await db.smsCampaigns.findByPk(id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });

    const chunks = campaign.chunks || [];
    const auth = beemAuth();

    // ── Spot-check a single number ──────────────────────────────────────────
    if (dest_addr) {
      // Find which chunk contains this number
      const chunk = chunks.find((c) => c.numbers && c.numbers.includes(dest_addr));
      if (!chunk || !chunk.requestId) {
        return res.status(404).json({ error: "Number not found in this campaign or requestId missing." });
      }
      try {
        const dlr = await axios.get(
          "https://dlrapi.beem.africa/public/v1/delivery-reports",
          {
            params: { dest_addr, request_id: chunk.requestId },
            headers: { "Content-Type": "application/json", Authorization: auth },
            timeout: 10000,
          }
        );
        const entry = Array.isArray(dlr.data) ? dlr.data[0] : dlr.data;
        return res.status(200).json({ spotCheck: true, result: entry });
      } catch (err) {
        return res.status(502).json({ error: "DLR query failed.", details: err.response?.data || err.message });
      }
    }

    // ── Aggregate stats from stored send-response data ──────────────────────
    let totalValid = 0;
    let totalInvalid = 0;
    let hasStoredStats = false;

    for (const chunk of chunks) {
      if (chunk.valid !== null && chunk.valid !== undefined) {
        totalValid += chunk.valid;
        totalInvalid += (chunk.invalid || 0);
        hasStoredStats = true;
      }
    }

    // Fallback: if no stored stats (old campaigns), use totalSent as valid
    if (!hasStoredStats) {
      totalValid = campaign.totalSent;
      totalInvalid = 0;
    }

    const requestIds = chunks
      .map((c) => c.requestId)
      .filter(Boolean);

    return res.status(200).json({
      summary: {
        accepted: totalValid,   // submitted to network — will be DELIVERED or PENDING
        rejected: totalInvalid, // invalid numbers — never sent
        total: campaign.totalSent,
      },
      requestIds,
      hasStoredStats,
      note: hasStoredStats
        ? "Stats reflect Beem's send-time validation. Use the spot-check (dest_addr query param) for per-number delivery status."
        : "This campaign was created before per-chunk stats were saved. Showing totalSent as accepted.",
    });
  } catch (err) {
    console.error("[SMS DLR] Error:", err);
    return res.status(500).json({ error: "Failed to fetch delivery report.", details: err.message });
  }
};

/**
 * GET /sms/campaigns/:id/delivery-report/full
 *
 * Per-recipient delivery breakdown, read straight from smsDeliveryReports —
 * populated at send time (status "pending") and resolved in the background
 * by cron/smsDeliveryReportChecker.js against Beem's DLR API. This is a
 * plain DB read so the report renders instantly regardless of campaign size.
 */
exports.getFullDeliveryReport = async (req, res) => {
  const { id } = req.params;

  try {
    const campaign = await db.smsCampaigns.findByPk(id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });

    const rows = await db.smsDeliveryReports.findAll({
      where: { campaignId: id },
      attributes: ["customerId", "customerName", "customerType", "phoneNumber", "status"],
      raw: true,
    });

    const toEntry = (r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      customerType: r.customerType,
      phoneNumber: r.phoneNumber,
    });

    const received = rows.filter((r) => r.status === "delivered").map(toEntry);
    const notReceived = rows.filter((r) => r.status === "not_delivered").map(toEntry);
    const pending = rows.filter((r) => r.status === "pending" || r.status === "unknown").map(toEntry);

    return res.status(200).json({
      total: rows.length,
      received,
      notReceived,
      pending,
    });
  } catch (err) {
    console.error("[SMS Full DLR] Error:", err);
    return res.status(500).json({ error: "Failed to fetch full delivery report.", details: err.message });
  }
};
