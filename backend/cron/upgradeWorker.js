const schedule = require("node-schedule");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { rescheduleJobs } = require("../Controller/upgrade");

const runReschedule = async (label) => {
  try {
    if (label) {
      console.log(`[UpgradeWorker] ${label}`);
    }
    await rescheduleJobs();
  } catch (error) {
    console.error("[UpgradeWorker] rescheduleJobs failed:", error.message || error);
  }
};

(async () => {
  await runReschedule("Initial reschedule on startup");

  schedule.scheduleJob("0 0 0,12 * * *", async () => {
    console.log("[UpgradeWorker] Running daily reschedule (0000hrs and 1200hrs)...");
    await runReschedule();
    console.log("[UpgradeWorker] Daily reschedule complete.");
  });
})();
