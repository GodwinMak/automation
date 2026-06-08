const cron = require("node-cron");
const { Op } = require("sequelize");
const db = require("../Models");

module.exports = (options = {}) => {
  const StatusChangeHistory = db.statusChangeHistories;
  const StatusChangeHistoryFtth = db.statusChangeHistoriesFtth;

  const cleanupStatusHistory = async () => {
    try {
      const [lockRows] = await db.sequelize.query(
        "SELECT GET_LOCK('status_history_cleanup', 0) AS acquired"
      );
      const acquired = lockRows?.[0]?.acquired === 1;
      if (!acquired) {
        console.warn("[StatusHistory Cleanup] Another instance is running. Skipping.");
        return;
      }

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
    } catch (error) {
      console.error("[StatusHistory Cleanup] Error:", error.message);
    } finally {
      await db.sequelize.query("SELECT RELEASE_LOCK('status_history_cleanup')");
    }
  };

  if (options.schedule !== false) {
    cron.schedule("30 2 * * *", cleanupStatusHistory);
    console.log("[StatusHistory Cleanup] Cron job scheduled daily at 02:30 AM");
  }

  return { cleanupStatusHistory };
};
