const cron = require("node-cron");
const { Op } = require("sequelize");
const db = require("../Models");
const { withLock } = require("../utils/cronLock");

module.exports = (options = {}) => {
  const StatusChangeHistory = db.statusChangeHistories;
  const StatusChangeHistoryFtth = db.statusChangeHistoriesFtth;

  const cleanupStatusHistory = async () => {
    try {
      await withLock("status_history_cleanup", async () => {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        const mainDeleted = await StatusChangeHistory.destroy({
          where: { changedAt: { [Op.lt]: cutoff } },
        });
        const ftthDeleted = await StatusChangeHistoryFtth.destroy({
          where: { changedAt: { [Op.lt]: cutoff } },
        });

        console.log(
          `[StatusHistory Cleanup] Deleted ${mainDeleted} main rows and ${ftthDeleted} FTTH rows older than 90 days.`
        );

        // cron_job_runs (utils/cronRunHistory.js) is written on every
        // withLock() call across every cron — including sms_sender_cron,
        // which runs every 15s — so it needs a much shorter retention than
        // status history or it grows unbounded. The process-monitoring
        // page only ever queries the last 90 days, so nothing older is
        // ever read.
        const runHistoryCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const runHistoryDeleted = await db.cronJobRuns.destroy({
          where: { startedAt: { [Op.lt]: runHistoryCutoff } },
        });
        console.log(`[StatusHistory Cleanup] Deleted ${runHistoryDeleted} cron_job_runs rows older than 30 days.`);
      });
    } catch (error) {
      console.error("[StatusHistory Cleanup] Error:", error.message);
    }
  };

  if (options.schedule !== false) {
    cron.schedule("30 2 * * *", cleanupStatusHistory);
    console.log("[StatusHistory Cleanup] Cron job scheduled daily at 02:30 AM");
  }

  return { cleanupStatusHistory };
};
