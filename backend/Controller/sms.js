const db = require("../Models");
const { sendSms } = require("../utils/sms");
const axios = require("axios");

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
 * Body: { customerType: "ftth"|..., message: string, extraNumbers?: string[], specificNumbers?: string[] }
 * If specificNumbers is provided the DB lookup is skipped and only those numbers are used.
 */
exports.sendBulkSms = async (req, res) => {
  const { customerType, message, extraNumbers, specificNumbers } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message is required." });
  }

  const manualNumbers = Array.isArray(extraNumbers)
    ? extraNumbers.map((n) => normalizePhone(n)).filter(Boolean)
    : [];

  try {
    let phoneNumbers = [];
    let customerCount = 0;

    const hasSpecific = Array.isArray(specificNumbers) && specificNumbers.length > 0;

    if (hasSpecific) {
      // Frontend passed an explicit selection — skip the DB lookup
      phoneNumbers = specificNumbers.map(normalizePhone).filter(Boolean);
      customerCount = phoneNumbers.length;
    } else if (customerType === "ftth") {
      const customers = await db.ftthcustomers.findAll({
        attributes: ["customerID", "customerName", "homeNumber"],
        where: { homeNumber: { [db.Sequelize.Op.ne]: null } },
      });
      phoneNumbers = customers.map((c) => c.homeNumber && normalizePhone(c.homeNumber)).filter(Boolean);
      customerCount = customers.length;
    } else {
      return res.status(400).json({ error: `customerType or specificNumbers is required.` });
    }

    const allNumbers = [...new Set([...phoneNumbers, ...manualNumbers])];

    if (allNumbers.length === 0) {
      return res.status(200).json({
        sent: 0,
        customerCount,
        extraCount: manualNumbers.length,
        message: "No phone numbers found for the selected customer type.",
      });
    }

    const CHUNK_SIZE = 1000;
    let totalSent = 0;
    const chunks = [];

    for (let i = 0; i < allNumbers.length; i += CHUNK_SIZE) {
      const numbers = allNumbers.slice(i, i + CHUNK_SIZE);
      const result = await sendSms(message.trim(), numbers);
      totalSent += numbers.length;
      chunks.push({
        requestId: result?.requestId || null,
        numbers,
        valid: result?.valid ?? null,
        invalid: result?.invalid ?? null,
      });
    }

    // Persist campaign record for delivery report lookup
    await db.smsCampaigns.create({
      customerType,
      message: message.trim(),
      chunks,
      totalSent,
      customerCount,
      extraCount: manualNumbers.length,
    });

    return res.status(200).json({
      sent: totalSent,
      customerCount,
      extraCount: manualNumbers.length,
      message: `SMS dispatched to ${totalSent} recipients (${manualNumbers.length} manually added).`,
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
      attributes: ["id", "customerType", "message", "totalSent", "customerCount", "extraCount", "createdAt"],
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
