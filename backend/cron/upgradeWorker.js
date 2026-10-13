const schedule = require("node-schedule");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { upgradeCustomer: upgradeDia } = require("../Controller/upgrade");
const { editTemporaryUpgrade: editTemporaryDia } = require("../Controller/upgrade");
const { upgradeCustomer: upgradeIpt } = require("../Controller/iptUpgrade");
const { editTemporaryUpgrade: editTemporaryIpt } = require("../Controller/iptUpgrade");
const { upgradeCustomer: upgradeL3vpn } = require("../Controller/l3vpnUpgrade");
const { editTemporaryUpgrade: editTemporaryL3vpn } = require("../Controller/l3vpnUpgrade");
const { rescheduleJobs: rescheduleDia } = require("../Controller/upgrade");
const { rescheduleJobs: rescheduleIpt } = require("../Controller/iptUpgrade");
const { rescheduleJobs: rescheduleL3vpn } = require("../Controller/l3vpnUpgrade");
const { startUpgradeWorkerRpcServer } = require("../utils/upgradeWorkerRpc");

const runReschedule = async (label) => {
  if (label) {
    console.log(`[UpgradeWorker] ${label}`);
  }
  try {
    await rescheduleDia();
  } catch (error) {
    console.error("[UpgradeWorker] DIA rescheduleJobs failed:", error.message || error);
  }
  try {
    await rescheduleIpt();
  } catch (error) {
    console.error("[UpgradeWorker] IPT rescheduleJobs failed:", error.message || error);
  }
  try {
    await rescheduleL3vpn();
  } catch (error) {
    console.error("[UpgradeWorker] L3VPN rescheduleJobs failed:", error.message || error);
  }
};

(async () => {
  await startUpgradeWorkerRpcServer({
    dia: upgradeDia,
    dia_edit_temporary: editTemporaryDia,
    ipt: upgradeIpt,
    ipt_edit_temporary: editTemporaryIpt,
    l3vpn: upgradeL3vpn,
    l3vpn_edit_temporary: editTemporaryL3vpn,
  });

  await runReschedule("Initial reschedule on startup");

  schedule.scheduleJob("0 0 0,12 * * *", async () => {
    console.log("[UpgradeWorker] Running daily reschedule (0000hrs and 1200hrs)...");
    await runReschedule();
    console.log("[UpgradeWorker] Daily reschedule complete.");
  });
})();
