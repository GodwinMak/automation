const axios = require("axios");

require("dotenv").config({ path: "../.env" });

const apiKey = process.env.BEEM_API_KEY;
const secretKey = process.env.BEEM_SECRET_KEY;
const senderId = process.env.BEEM_SENDER_ID;
const recipients = process.env.SMS_RECIPIENTS ? process.env.SMS_RECIPIENTS.split(",") : [];

/**
 * Strip/replace Unicode characters so Beem accepts the message as plain ASCII.
 * Handles smart quotes, dashes, ellipsis, and other common copy-paste artifacts.
 */
function toPlainAscii(text) {
  return text
    // Smart / curly quotes → straight quotes
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    // En-dash, em-dash → hyphen
    .replace(/[\u2013\u2014\u2015]/g, "-")
    // Ellipsis → three dots
    .replace(/\u2026/g, "...")
    // Non-breaking space, thin space, etc. → regular space
    .replace(/[\u00A0\u202F\u2009\u2008\u2007\u2006\u2005\u2004\u2003\u2002\u2001\u2000]/g, " ")
    // Bullet variants → hyphen
    .replace(/[\u2022\u2023\u2024\u2025\u2043\u204C\u204D]/g, "-")
    // Strip any remaining non-ASCII characters
    .replace(/[^\x00-\x7F]/g, "");
}

/**
 * Send SMS via Beem API
 * @param {string} message - SMS content
 * @param {string[]} [customRecipients] - Optional array of phone numbers; falls back to env SMS_RECIPIENTS
 */
async function sendSms(message, customRecipients) {
  const recipientList = customRecipients && customRecipients.length > 0
    ? customRecipients
    : recipients;

  if (!apiKey || !secretKey || !senderId || recipientList.length === 0) {
    console.warn("[SMS] Missing configuration, skipping send.");
    return;
  }

  const safeMessage = toPlainAscii(message).substring(0, 480);

  const payload = {
    source_addr: senderId,
    encoding: 0,
    message: safeMessage,
    recipients: recipientList.map((num, idx) => ({
      recipient_id: idx + 1,
      dest_addr: num.trim(),
    })),
  };

  try {
    const response = await axios.post(
      "https://apisms.beem.africa/v1/send",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(`${apiKey}:${secretKey}`).toString("base64"),
        },
      }
    );
    if (response.data && response.data.code === 100) {
      console.log("[SMS] Sent successfully:", safeMessage.slice(0, 50));
      return { requestId: String(response.data.request_id), valid: response.data.valid, invalid: response.data.invalid };
    } else {
      console.error("[SMS] API error:", response.data);
      return null;
    }
  } catch (err) {
    console.error("[SMS] Request failed:", err.response?.data || err.message);
    return null;
  }
}

module.exports = { sendSms };