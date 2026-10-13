const db = require("../Models");
const { Op } = require("sequelize");
const { resolveDeliveryStatuses } = require("../utils/smsDlrChecker");
const { withLock } = require("../utils/cronLock");

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // how often this worker wakes up
const GRACE_PERIOD_MS = 60 * 1000; // give Beem at least this long to settle a fresh send
const MAX_ATTEMPTS = 12; // ~1 hour of retries at the interval above before giving up
const BATCH_LIMIT = 500; // rows pulled per run, to bound each pass

module.exports = (_io, options = {}) => {
  const checkPendingDeliveryReports = async () => {
    await withLock("sms_dlr_checker_cron", async () => {
    try {
      const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
      const rows = await db.smsDeliveryReports.findAll({
        where: {
          status: "pending",
          requestId: { [Op.ne]: null },
          createdAt: { [Op.lte]: cutoff },
          attempts: { [Op.lt]: MAX_ATTEMPTS },
        },
        order: [["createdAt", "ASC"]],
        limit: BATCH_LIMIT,
      });

      if (rows.length === 0) return;

      console.log(`[SMS-DLR] Checking ${rows.length} pending delivery report(s)...`);

      const rowById = new Map(rows.map((r) => [r.id, r]));
      const results = await resolveDeliveryStatuses(
        rows.map((r) => ({ id: r.id, phoneNumber: r.phoneNumber, requestId: r.requestId }))
      );

      let delivered = 0, notDelivered = 0, stillPending = 0, expired = 0;

      for (const result of results) {
        const row = rowById.get(result.id);
        if (!row) continue;
        const attempts = row.attempts + 1;

        let finalStatus = result.status;
        if (finalStatus === "pending" && attempts >= MAX_ATTEMPTS) {
          finalStatus = "unknown";
          expired++;
        } else if (finalStatus === "delivered") {
          delivered++;
        } else if (finalStatus === "not_delivered") {
          notDelivered++;
        } else {
          stillPending++;
        }

        await row.update({ status: finalStatus, attempts, lastCheckedAt: new Date() });
      }

      console.log(
        `[SMS-DLR] delivered=${delivered} notDelivered=${notDelivered} stillPending=${stillPending} expired=${expired}`
      );
    } catch (err) {
      console.error("[SMS-DLR] Check failed:", err.message);
    }
    });
  };

  if (options.schedule !== false) {
    const runAndReschedule = async () => {
      try {
        await checkPendingDeliveryReports();
      } catch (err) {
        console.error("[SMS-DLR] Scheduled run failed:", err.message || err);
      } finally {
        setTimeout(runAndReschedule, CHECK_INTERVAL_MS);
      }
    };
    runAndReschedule();
  }

  return { checkPendingDeliveryReports };
};
