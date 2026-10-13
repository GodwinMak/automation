const db = require("../Models");
const { sendMail } = require("../utils/mailer");

const normalizeEmail = (value) => {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
};

exports.sendBulkEmail = async (req, res) => {
  const { sendMode, customerType, subject, message, extraEmails, specificRecipients } = req.body;

  if (!subject || !String(subject).trim()) {
    return res.status(400).json({ error: "subject is required." });
  }
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: "message is required." });
  }
  if (!sendMode || (sendMode !== "specific" && sendMode !== "all")) {
    return res.status(400).json({ error: "sendMode must be 'specific' or 'all'." });
  }

  const manualEmails = Array.isArray(extraEmails)
    ? extraEmails.map(normalizeEmail).filter(Boolean)
    : [];

  try {
    let recipients = [];
    let customerCount = 0;

    if (sendMode === "specific") {
      const hasStructured = Array.isArray(specificRecipients) && specificRecipients.length > 0;
      if (!hasStructured && manualEmails.length === 0) {
        return res.status(400).json({ error: "specificRecipients or extraEmails is required when sendMode is 'specific'." });
      }

      recipients = hasStructured
        ? specificRecipients
            .map((r) => ({
              customerId: r.customerId || null,
              customerName: r.customerName || null,
              customerType: r.customerType || customerType || null,
              emailAddress: normalizeEmail(r.emailAddress),
            }))
            .filter((r) => r.emailAddress)
        : [];
      customerCount = recipients.length;
    } else {
      if (customerType !== "ftth") {
        return res.status(400).json({ error: "customerType='ftth' is currently required for sendMode='all'." });
      }

      const customers = await db.ftthcustomerinfos.findAll({
        attributes: ["customerID", "customerName", "emailAddress"],
        where: { emailAddress: { [db.Sequelize.Op.ne]: null } },
        raw: true,
      });

      recipients = customers
        .map((c) => ({
          customerId: c.customerID || null,
          customerName: c.customerName || null,
          customerType: "FTTH",
          emailAddress: normalizeEmail(c.emailAddress),
        }))
        .filter((r) => r.emailAddress);
      customerCount = recipients.length;
    }

    for (const emailAddress of manualEmails) {
      recipients.push({ customerId: null, customerName: null, customerType: "manual", emailAddress });
    }

    const totalBeforeDedupe = recipients.length;
    const recipientByEmail = new Map();
    for (const r of recipients) {
      if (!recipientByEmail.has(r.emailAddress)) recipientByEmail.set(r.emailAddress, r);
    }
    recipients = [...recipientByEmail.values()];
    const deduplicatedCount = Math.max(0, totalBeforeDedupe - recipients.length);

    if (recipients.length === 0) {
      return res.status(200).json({
        sent: 0,
        customerCount,
        extraCount: manualEmails.length,
        message: "No valid email addresses found.",
      });
    }

    const campaign = await db.emailCampaigns.create({
      customerType: customerType || "mixed",
      subject: String(subject).trim(),
      message: String(message).trim(),
      recipients,
      status: "sending",
      totalSent: 0,
      customerCount,
      extraCount: manualEmails.length,
    });

    let sent = 0;
    const failed = [];

    try {
      const allEmails = recipients.map((r) => r.emailAddress).filter(Boolean);
      const info = await sendMail({
        // Keep TO non-empty; all selected customers are sent via BCC.
        to: process.env.EMAIL_USER,
        bcc: allEmails,
        subject: campaign.subject,
        text: campaign.message,
        html: `<p>${campaign.message.replace(/\n/g, "<br/>")}</p>`,
      });

      const rejectedSet = new Set((info?.rejected || []).map((e) => String(e).toLowerCase()));
      sent = allEmails.filter((e) => !rejectedSet.has(String(e).toLowerCase())).length;
      for (const emailAddress of allEmails) {
        if (rejectedSet.has(String(emailAddress).toLowerCase())) {
          failed.push({ emailAddress, error: "rejected by SMTP" });
        }
      }
    } catch (err) {
      for (const r of recipients) {
        failed.push({ emailAddress: r.emailAddress, error: err.message || "send failed" });
      }
    }

    await campaign.update({
      status: failed.length ? (sent ? "completed" : "failed") : "completed",
      totalSent: sent,
      errorMessage: failed.length ? `${failed.length} recipients failed` : null,
    });

    return res.status(200).json({
      campaignId: campaign.id,
      sent,
      failed: failed.length,
      failures: failed,
      customerCount,
      extraCount: manualEmails.length,
      deduplicatedCount,
      message: `Email sent to ${sent} recipient(s).${failed.length ? ` ${failed.length} failed.` : ""}`,
    });
  } catch (err) {
    console.error("[Email Controller] Error:", err);
    return res.status(500).json({ error: "Failed to send emails.", details: err.message });
  }
};

exports.getCampaigns = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 20);

  try {
    const { count, rows } = await db.emailCampaigns.findAndCountAll({
      order: [["createdAt", "DESC"]],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    return res.status(200).json({
      campaigns: rows,
      totalItems: count,
      totalPages: Math.ceil(count / pageSize),
      currentPage: page,
    });
  } catch (err) {
    console.error("[Email Campaigns] Error:", err);
    return res.status(500).json({ error: "Failed to fetch campaigns.", details: err.message });
  }
};
