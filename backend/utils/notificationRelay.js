const axios = require("axios");

const DEFAULT_RELAY_BASE_URL = "http://127.0.0.1:4000";

const isCronWorkerProcess = () => {
  const argv = (process.argv || []).join(" ");
  return argv.includes("cron-runner.js") || process.env.CRON_WORKER === "1";
};

const relayLinkDownAlert = async (payload) => {
  // Relay only from worker processes to avoid unnecessary loopbacks from the server process.
  if (!isCronWorkerProcess()) return false;

  const relayBaseUrl = (process.env.NOTIFICATION_RELAY_URL || DEFAULT_RELAY_BASE_URL).replace(/\/$/, "");
  const internalToken = process.env.INTERNAL_NOTIFY_TOKEN;

  if (!internalToken) {
    console.warn("[NotificationRelay] INTERNAL_NOTIFY_TOKEN is not set; skipping relay.");
    return false;
  }

  try {
    await axios.post(
      `${relayBaseUrl}/internal/notifications/link-down`,
      payload,
      {
        headers: {
          "x-internal-token": internalToken,
        },
        timeout: 5000,
      }
    );
    return true;
  } catch (error) {
    console.error("[NotificationRelay] Relay failed:", error.message);
    return false;
  }
};

module.exports = {
  relayLinkDownAlert,
  isCronWorkerProcess,
};
