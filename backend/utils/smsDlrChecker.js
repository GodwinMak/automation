/**
 * Shared Beem DLR (delivery-report) resolution helper.
 * Used by cron/smsDeliveryReportChecker.js to poll pending smsDeliveryReport
 * rows in small concurrent batches — Beem's DLR API only supports checking
 * one number at a time, so this avoids hammering it or blocking the event
 * loop on large campaigns.
 */
const axios = require("axios");

const beemAuth = () =>
  "Basic " +
  Buffer.from(
    `${process.env.BEEM_API_KEY}:${process.env.BEEM_SECRET_KEY}`
  ).toString("base64");

const DLR_BATCH_SIZE = 12;

/**
 * @param {{ id: string, phoneNumber: string, requestId: string }[]} entries
 * @returns {Promise<{ id: string, phoneNumber: string, requestId: string, status: "delivered"|"not_delivered"|"pending" }[]>}
 */
async function resolveDeliveryStatuses(entries) {
  const auth = beemAuth();
  const results = [];

  for (let i = 0; i < entries.length; i += DLR_BATCH_SIZE) {
    const batch = entries.slice(i, i + DLR_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((entry) =>
        axios.get("https://dlrapi.beem.africa/public/v1/delivery-reports", {
          params: { dest_addr: entry.phoneNumber, request_id: entry.requestId },
          headers: { "Content-Type": "application/json", Authorization: auth },
          timeout: 10000,
        })
      )
    );

    settled.forEach((result, idx) => {
      const entry = batch[idx];
      if (result.status !== "fulfilled") {
        results.push({ ...entry, status: "pending" });
        return;
      }
      const data = Array.isArray(result.value.data) ? result.value.data[0] : result.value.data;
      const rawStatus = String(data?.status || data?.delivery_status || "").toUpperCase();

      let status;
      if (rawStatus.includes("DELIVER") && !rawStatus.includes("UNDELIVER")) {
        status = "delivered";
      } else if (!rawStatus) {
        status = "pending";
      } else {
        status = "not_delivered";
      }
      results.push({ ...entry, status });
    });
  }

  return results;
}

module.exports = { resolveDeliveryStatuses, DLR_BATCH_SIZE };
