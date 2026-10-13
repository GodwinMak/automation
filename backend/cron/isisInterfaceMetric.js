const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op } = require("sequelize");
const pLimit = require("p-limit").default;

const { withLock } = require("../utils/cronLock");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// The ISIS metric ("show isis interface") is essentially static
// per-interface config — it only changes when someone deliberately
// reconfigures ISIS — unlike traffic stats, which move constantly. No
// reason to poll it on the same cadence as cron/isisInterfaceStats.js;
// this runs much slower (see schedule below).
module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 30000,
  };

  // readyTimeout above only bounds the SSH handshake. Once conn.exec() opens
  // a channel, nothing bounds how long we wait for its "close" event — a
  // device that accepts the exec but never closes the channel leaves the
  // promise (and the connection) hanging forever, which is exactly the kind
  // of leaked session that can exhaust a router's limited concurrent SSH
  // session pool and lock out real admins. This watchdog forces conn.end()
  // if the command doesn't finish in time.
  const EXEC_COMMAND_TIMEOUT_MS = 30000;

  const runSingleCommand = (host, cmd) =>
    new Promise((resolve, reject) => {
      const conn = new Client();
      let data = "";
      let isDone = false;

      const timeoutTimer = setTimeout(() => {
        finish(reject, new Error(`Timed out waiting for command output from ${host} (${EXEC_COMMAND_TIMEOUT_MS / 1000}s): ${cmd}`));
        conn.end();
      }, EXEC_COMMAND_TIMEOUT_MS);

      const finish = (fn, arg) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutTimer);
        fn(arg);
      };

      conn
        .on("ready", () => {
          conn.exec(cmd, (err, stream) => {
            if (err) {
              conn.end();
              return finish(reject, err);
            }
            stream
              .on("data", (d) => { data += d.toString(); })
              .on("close", () => {
                conn.end();
                finish(resolve, data.trim());
              });
          });
        })
        .on("error", (err) => finish(reject, err))
        .connect({ host, ...sshConfig });
    });

  const parseISISInterfaces = (output) => {
    const map = {};
    for (const line of output.split("\n")) {
      const m = line.match(/^(\S+)\s+\d+\s+0x[0-9a-fA-F]+\s+\S.*\s+(\d+)\/(\d+)\s*$/);
      if (!m) continue;
      const entry = { l1: parseInt(m[2], 10), l2: parseInt(m[3], 10) };
      map[m[1]] = entry;
      const base = m[1].replace(/\.\d+$/, "");
      if (!map[base]) map[base] = entry;
    }
    return map;
  };

  const checkInterfaceMetric = async () => {
    await withLock("isis_metric_cron", async () => {
      const devices = await Devices.findAll({
        where: { ip: { [Op.notIn]: ["41.175.37.22", "41.175.37.23"] } },
      });

      const processDevice = async (device) => {
        try {
          // Only annotate interfaces the adjacency job currently considers
          // Up — it owns discovering/tearing down adjacencies via SSH,
          // this job just annotates existing rows with their metric.
          const upLinks = await IsisAdjacency.findAll({
            where: { local_device_id: device.id, state: "Up" },
            raw: true,
          });
          if (upLinks.length === 0) return;

          const isisIntfRaw = await runSingleCommand(device.ip, "show isis interface");
          const metricMap = parseISISInterfaces(isisIntfRaw);

          for (const link of upLinks) {
            const metricEntry = metricMap[link.raw_interface] || metricMap[link.interface];
            const metric = metricEntry ? (link.level === 2 ? metricEntry.l2 : metricEntry.l1) : null;

            await IsisAdjacency.update({ metric }, { where: { id: link.id } });
          }

          console.log(`[ISIS-Metric] ✓ ${device.name} metric updated`);
        } catch (err) {
          console.error(`[ISIS-Metric] ✗ ${device.ip}: ${err.message}`);
        }
      };

      const limit = pLimit(10);
      await Promise.all(devices.map((device) => limit(() => processDevice(device))));
    });
  };

  if (options.schedule !== false) {
    checkInterfaceMetric().catch(console.error);
    cron.schedule("*/15 * * * *", () => {
      checkInterfaceMetric().catch(console.error);
    });
  }

  return { checkInterfaceMetric };
};
