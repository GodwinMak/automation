/**
 * Background SMS sender.
 *
 * POST /sms/send (Controller/sms.js) only validates the request and writes
 * a "queued" smsCampaign row with a recipient snapshot — it never calls
 * Beem directly. This worker (its own PM2 process, cron-worker-sms-send)
 * picks up queued campaigns, does the actual chunked Beem send, and seeds
 * the per-recipient smsDeliveryReports rows that cron/smsDeliveryReportChecker.js
 * later resolves. Keeping this off the automation-server cluster means a
 * large broadcast (many 1000-number chunks) never ties up an HTTP request
 * or blocks other traffic on that process.
 */
const db = require("../Models");
const { sendSms } = require("../utils/sms");
const { withLock } = require("../utils/cronLock");

const POLL_INTERVAL_MS = 15 * 1000;
const CHUNK_SIZE = 1000;

const isSortMemoryError = (err) =>
  typeof err?.message === "string" && err.message.toLowerCase().includes("out of sort memory");

const getNextQueuedCampaign = async () => {
  try {
    // Prefer oldest-first when DB can handle ordering.
    return await db.smsCampaigns.findOne({
      where: { status: "queued" },
      order: [["createdAt", "ASC"]],
    });
  } catch (err) {
    // Large campaign tables can hit MySQL sort-buffer limits on ORDER BY.
    // Fallback keeps the worker alive and processing queued items.
    if (!isSortMemoryError(err)) throw err;
    console.warn("[SMS-Sender] ORDER BY createdAt hit sort-memory limit; falling back to unordered queue fetch.");
    return db.smsCampaigns.findOne({ where: { status: "queued" } });
  }
};

const sendCampaign = async (campaign) => {
  await campaign.update({ status: "sending" });

  const recipients = Array.isArray(campaign.recipients) ? campaign.recipients : [];
  const recipientByPhone = new Map(recipients.map((r) => [r.phoneNumber, r]));
  const allNumbers = [...recipientByPhone.keys()];

  const chunks = [];
  let totalSent = 0;

  try {
    for (let i = 0; i < allNumbers.length; i += CHUNK_SIZE) {
      const numbers = allNumbers.slice(i, i + CHUNK_SIZE);
      const result = await sendSms(campaign.message, numbers);
      totalSent += numbers.length;
      chunks.push({
        requestId: result?.requestId || null,
        numbers,
        valid: result?.valid ?? null,
        invalid: result?.invalid ?? null,
      });
    }

    // Seed one "pending" delivery-report row per recipient. The DLR checker
    // cron (cron/smsDeliveryReportChecker.js) fills these in from Beem's
    // DLR API so the report page can read them back instantly.
    const deliveryReportRows = [];
    for (const chunk of chunks) {
      for (const number of chunk.numbers) {
        const recipient = recipientByPhone.get(number);
        deliveryReportRows.push({
          campaignId: campaign.id,
          customerId: recipient?.customerId || null,
          customerName: recipient?.customerName || null,
          customerType: recipient?.customerType || null,
          phoneNumber: number,
          requestId: chunk.requestId || null,
          // No requestId means Beem never accepted this chunk — the DLR
          // checker can't look it up, so don't leave it stuck "pending" forever.
          status: chunk.requestId ? "pending" : "unknown",
        });
      }
    }
    if (deliveryReportRows.length > 0) {
      await db.smsDeliveryReports.bulkCreate(deliveryReportRows);
    }

    await campaign.update({ chunks, totalSent, status: "completed" });
    console.log(`[SMS-Sender] Campaign ${campaign.id} completed: ${totalSent} recipients across ${chunks.length} chunk(s).`);
  } catch (err) {
    // Persist whatever chunks succeeded before the failure, so any numbers
    // that did get a requestId still show up in delivery reports.
    await campaign.update({ chunks, totalSent, status: "failed", errorMessage: err.message });
    console.error(`[SMS-Sender] Campaign ${campaign.id} failed:`, err.message);
  }
};

module.exports = (_io, options = {}) => {
  const processQueuedCampaigns = async () => {
    // failOpen: false — unlike the other cron locks, an unprotected overlap
    // here would double-send a queued campaign's SMS to every recipient if
    // Redis happened to be unreachable, so skip the tick rather than risk it.
    await withLock("sms_sender_cron", async () => {
      try {
        // Loop, not a single pass — a slow poll interval shouldn't leave a
        // second queued campaign waiting a full cycle behind the first.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const campaign = await getNextQueuedCampaign();
          if (!campaign) break;
          await sendCampaign(campaign);
        }
      } catch (err) {
        console.error("[SMS-Sender] Check failed:", err.message);
      }
    }, { failOpen: false });
  };

  if (options.schedule !== false) {
    const runAndReschedule = async () => {
      try {
        await processQueuedCampaigns();
      } catch (err) {
        console.error("[SMS-Sender] Scheduled run failed:", err.message || err);
      } finally {
        setTimeout(runAndReschedule, POLL_INTERVAL_MS);
      }
    };
    runAndReschedule();
  }

  return { processQueuedCampaigns };
};
