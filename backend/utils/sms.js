const axios = require("axios");

require("dotenv").config({ path: "../.env" });

// Environment variables needed:
// BEEM_API_KEY, BEEM_SECRET_KEY, BEEM_SENDER_ID, SMS_RECIPIENTS (comma separated)
const apiKey = process.env.BEEM_API_KEY;
const secretKey = process.env.BEEM_SECRET_KEY;
const senderId = process.env.BEEM_SENDER_ID;
const recipients = process.env.SMS_RECIPIENTS ? process.env.SMS_RECIPIENTS.split(",") : [];

/**
 * Send SMS via Beem API
 * @param {string} message - SMS content (max 160 chars per segment, but we'll handle)
 * @returns {Promise<void>}
 */
async function sendSms(message) {
  if (!apiKey || !secretKey || !senderId || recipients.length === 0) {
    console.warn("[SMS] Missing configuration, skipping send.");
    return;
  }

  const payload = {
    source_addr: senderId,
    encoding: 0,
    message: message.substring(0, 480), // limit length
    recipients: recipients.map((num, idx) => ({
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
    if (response.data && response.data.code === 200) {
      console.log("[SMS] Sent successfully:", message.slice(0, 50));
    } else {
      console.error("[SMS] API error:", response.data);
    }
  } catch (err) {
    console.error("[SMS] Request failed:", err.response?.data || err.message);
  }
}

module.exports = { sendSms };