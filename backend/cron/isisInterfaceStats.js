const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op } = require("sequelize");
const pLimit = require("p-limit").default;

const { sendSms } = require("../utils/sms");
const { withLock } = require("../utils/cronLock");
const { getIsisAlertRecipients } = require("../utils/notificationRecipients");
const { parseInterfaceDetails, computeUtilization } = require("../utils/junosInterfaceStats");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// Split out of cron/isisAdjacent.js: per-interface traffic stats aren't on
// the link Up/Down/alert path at all — they only enrich existing rows and
// feed the high-traffic alert below. Bundling them into the adjacency job
// meant every device needed 1 + N SSH connections (N = number of
// ISIS-adjacent interfaces) on its 2-minute schedule, which is what pushed
// that job's mean runtime past its own schedule interval. This job owns
// port_speed/input_bps/output_bps and can run on a slower cadence — the
// high-traffic alert already has a 2h cooldown, so there's no benefit to
// polling faster. ISIS metric ("show isis interface") is a separate,
// even-slower job — see cron/isisInterfaceMetric.js.
module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 30000,
  };

  // Single command, its own SSH connection. Junos caps
  // `max-sessions-per-connection` at 1 by default — confirmed empirically
  // on these devices, multiplexed exec channels on one connection just
  // don't run — so parallelism has to come from separate connections,
  // bounded by statConnLimit below.
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

  const checkInterfaceStats = async () => {
    await withLock("isis_stats_cron", async () => {
      const devices = await Devices.findAll({
        where: { ip: { [Op.notIn]: ["41.175.37.22", "41.175.37.23"] } },
      });
      const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

      // Per-link recipient resolution — see cron/isisAdjacent.js and
      // utils/notificationRecipients.js for why this can no longer be a
      // single flat list computed once per run.
      const sendIsisSms = async (message, pointToPointIp) => {
        const { phoneNumbers } = await getIsisAlertRecipients(pointToPointIp, "highTraffic");
        if (phoneNumbers.length === 0) {
          console.warn("[ISIS-Stats] No users configured to receive this link's SMS alerts — skipping SMS.");
          return Promise.resolve();
        }
        return sendSms(message, phoneNumbers);
      };

      const processDevice = async (device) => {
        try {
          // Only poll interfaces the adjacency job currently considers Up —
          // it owns discovering/tearing down adjacencies via SSH, this job
          // just annotates existing rows with traffic stats.
          const upLinks = await IsisAdjacency.findAll({
            where: { local_device_id: device.id, state: "Up" },
            raw: true,
          });
          if (upLinks.length === 0) return;

          const uniqueInterfaces = [...new Set(upLinks.map((l) => l.interface))];
          const statCommands = uniqueInterfaces.map(
            (iface) => `show interfaces ${iface} statistics | match "bps|Speed"`
          );

          let statResults = [];
          if (statCommands.length > 0) {
            try {
              const statConnLimit = pLimit(4);
              statResults = await Promise.all(
                statCommands.map((cmd) => statConnLimit(() => runSingleCommand(device.ip, cmd)))
              );
            } catch (statErr) {
              console.warn(`[ISIS-Stats] ${device.ip}: stats collection failed (${statErr.message})`);
            }
          }
          const statsMap = Object.fromEntries(
            uniqueInterfaces.map((iface, i) => [iface, parseInterfaceDetails(statResults[i])])
          );

          for (const link of upLinks) {
            const ifaceStats = statsMap[link.interface] || {};

            await IsisAdjacency.update(
              {
                port_speed: ifaceStats.speed ?? null,
                input_bps: ifaceStats.input_bps ?? null,
                output_bps: ifaceStats.output_bps ?? null,
              },
              { where: { id: link.id } }
            );
          }

          console.log(`[ISIS-Stats] ✓ ${device.name} traffic stats updated`);
        } catch (err) {
          console.error(`[ISIS-Stats] ✗ ${device.ip}: ${err.message}`);
        }
      };

      const limit = pLimit(10);
      await Promise.all(devices.map((device) => limit(() => processDevice(device))));

      // --- High Traffic alerts (Up links, utilisation >85%, cooldown 2h) ---
      const now = new Date();
      const highTrafficLinks = await IsisAdjacency.findAll({
        where: {
          state: "Up",
          port_speed: { [Op.ne]: null },
          input_bps: { [Op.ne]: null },
          output_bps: { [Op.ne]: null },
        },
        raw: true,
      });

      for (const link of highTrafficLinks) {
        const util = computeUtilization(link.input_bps, link.output_bps, link.port_speed);
        if (util && util > 85) {
          const lastAlert = link.last_high_traffic_alert;
          if (!lastAlert || (now - new Date(lastAlert)) > 2 * 60 * 60 * 1000) {
            const deviceName = deviceMap.get(link.local_device_id) || link.local_device_id;
            const message = `HIGH TRAFFIC: ${deviceName} > ${link.neighbor_name} | ${link.interface} | Utilisation ${util.toFixed(1)}% (>85%) | Speed: ${link.port_speed} Mbps`;
            await sendIsisSms(message, link.point_to_point_ip);
            await IsisAdjacency.update(
              { last_high_traffic_alert: now },
              { where: { id: link.id } }
            );
            console.log(`[Alert] High traffic SMS sent for ${link.interface} (${util.toFixed(1)}%)`);
          }
        }
      }
    });
  };

  if (options.schedule !== false) {
    checkInterfaceStats().catch(console.error);
    cron.schedule("*/5 * * * *", () => {
      checkInterfaceStats().catch(console.error);
    });
  }

  return { checkInterfaceStats };
};
