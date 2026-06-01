const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op } = require("sequelize");

const { sendSms } = require("../utils/sms");
const sendPushNotification = require("../utils/sendPushNotification");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// Helper: Format date in EAT (UTC+3)
const toEATString = (date) => {
  const eatDate = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return eatDate.toLocaleString("en-GB", { hour12: false });
};

module.exports = (io) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 30000,
  };

  const runCommandsInSession = (host, commands) =>
    new Promise((resolve, reject) => {
      const conn = new Client();
      let results = [];
      conn
        .on("ready", async () => {
          try {
            for (const cmd of commands) {
              const res = await new Promise((resCmd, rejCmd) => {
                let data = "";
                conn.exec(cmd, (err, stream) => {
                  if (err) return rejCmd(err);
                  stream
                    .on("data", (d) => { data += d.toString(); })
                    .on("close", () => resCmd(data.trim()));
                });
              });
              results.push(res);
            }
            conn.end();
            resolve(results);
          } catch (err) {
            conn.end();
            reject(err);
          }
        })
        .on("error", reject)
        .connect({ host, ...sshConfig });
    });

  const parseISISAdjacency = (output) => {
    const RE = /^(\S+)\s+(\S+)\s+(\d+)\s+(Up|Down)\s+(\d+)\s*(.*)$/;
    return output.split("\n").map(l => l.match(RE)).filter(Boolean).map(m => ({
      raw_interface: m[1],
      interface: m[1].replace(/\.\d+$/, ""),
      neighbor_name: m[2],
      level: parseInt(m[3]),
    }));
  };

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

  /**
   * New Parser: Extracts Speed, Input bps, and Output bps
   */
  const parseInterfaceDetails = (output) => {
    const stats = { speed: null, input_bps: null, output_bps: null };
    if (!output) return stats;

    // Extract Speed
    const speedMatch = output.match(/Speed:\s*(\d+)\s*(G|m)bps/i);
    if (speedMatch) {
      let val = parseInt(speedMatch[1], 10);
      stats.speed = speedMatch[2].toLowerCase() === 'g' ? val * 1000 : val;
    }

    // Extract Input Rate (bps)
    const inputMatch = output.match(/Input rate\s*:\s*(\d+)\s*bps/i);
    if (inputMatch) stats.input_bps = BigInt(inputMatch[1]).toString();

    // Extract Output Rate (bps)
    const outputMatch = output.match(/Output rate\s*:\s*(\d+)\s*bps/i);
    if (outputMatch) stats.output_bps = BigInt(outputMatch[1]).toString();

    return stats;
  };

  // Helper: compute utilisation % from bps and port speed (in Mbps)
  const computeUtilization = (inputBpsStr, outputBpsStr, portSpeedMbps) => {
    if (!portSpeedMbps) return null;
    const inBps = parseInt(inputBpsStr, 10) || 0;
    const outBps = parseInt(outputBpsStr, 10) || 0;
    const maxBps = Math.max(inBps, outBps);
    const maxMbps = maxBps / 1e6;
    return (maxMbps / portSpeedMbps) * 100;
  };

  // Format duration from down to up (milliseconds)
  const formatDuration = (downTime, upTime) => {
    const diffMs = upTime - downTime;
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const checkAdjacency = async () => {
    // MySQL advisory lock to prevent overlapping runs in PM2 cluster
    const [[{ acquired }]] = await db.sequelize.query(
      "SELECT GET_LOCK('isis_adjacent_cron', 0) AS acquired"
    );
    if (!acquired) {
      console.warn("[ISIS] Another instance is already running — skipping this tick.");
      return;
    }
    try {
    const devices = await Devices.findAll({
      where: { ip: { [Op.notIn]: ["41.175.37.22", "41.175.37.23"] } },
    });

    const timestamp = new Date();

    for (const device of devices) {
      try {
        // --- 1. Capture previous state from DB ---
        const previousRecords = await IsisAdjacency.findAll({
          where: { local_device_id: device.id },
          raw: true,
        });
        const prevMap = new Map();
        previousRecords.forEach(rec => {
          const key = `${rec.interface}|${rec.neighbor_name}|${rec.level}`;
          prevMap.set(key, rec);
        });

        // --- 2. SSH data collection ---
        const [adjRaw, isisIntfRaw] = await runCommandsInSession(device.ip, [
          "show isis adjacency",
          "show isis interface"
        ]);

        const adjacencies = parseISISAdjacency(adjRaw);
        const metricMap = parseISISInterfaces(isisIntfRaw);

        const uniqueInterfaces = [...new Set(adjacencies
          .filter(a => !a.interface.startsWith("lo"))
          .map(a => a.interface))];
        
        const statCommands = uniqueInterfaces.map(iface => 
            `show interfaces ${iface} statistics | match "bps|Speed"`
        );
        const statResults = statCommands.length > 0 
          ? await runCommandsInSession(device.ip, statCommands)
          : [];
        const statsMap = Object.fromEntries(uniqueInterfaces.map((iface, i) => [
            iface, parseInterfaceDetails(statResults[i])
        ]));

        // --- 3. Build set of currently UP adjacencies (from SSH) ---
        const currentUpKeys = new Set();
        for (const adj of adjacencies) {
          const key = `${adj.interface}|${adj.neighbor_name}|${adj.level}`;
          currentUpKeys.add(key);
        }

        // --- 4. Detect failures BEFORE any DB updates ---
        const failures = [];
        for (const [key, prevRec] of prevMap.entries()) {
          if (prevRec.state === "Up" && !currentUpKeys.has(key)) {
            // Was Up in DB, not in current SSH output -> failure
            failures.push(prevRec);
          }
        }

        // --- 5. Upsert current UP adjacencies ---
        for (const adj of adjacencies) {
          const metricEntry = metricMap[adj.raw_interface] || metricMap[adj.interface];
          const metric = metricEntry ? (adj.level === 2 ? metricEntry.l2 : metricEntry.l1) : null;
          const ifaceStats = statsMap[adj.interface] || {};

          await IsisAdjacency.upsert({
            local_device_id: device.id,
            neighbor_name: adj.neighbor_name,
            interface: adj.interface,
            raw_interface: adj.raw_interface,
            level: adj.level,
            state: "Up",
            last_seen: timestamp,
            last_checked: timestamp,
            metric,
            port_speed: ifaceStats.speed || null,
            input_bps: ifaceStats.input_bps || null,
            output_bps: ifaceStats.output_bps || null,
          });
        }

        // --- 6. Mark missing links as Down ---
        // Only mark as Down the links that were Up but are now missing from SSH
        for (const failure of failures) {
          await IsisAdjacency.update(
            { state: "Down", last_checked: timestamp },
            { 
              where: { 
                id: failure.id
              } 
            }
          );
        }

        // --- 7. Detect recoveries (only for links that were previously marked Down) ---
        const recoveries = [];
        for (const [key, prevRec] of prevMap.entries()) {
          if (prevRec.state === "Down" && currentUpKeys.has(key)) {
            // Was Down in DB, now appears in SSH -> recovery
            recoveries.push({ previous: prevRec, newUp: true });
          }
        }

        // --- 8. Send alerts for failures ---
        for (const failure of failures) {
          const lastAlert = failure.last_down_alert_sent;
          const now = new Date();
          // Cooldown: send only once per down event (if last alert > 2 hours or null)
          if (!lastAlert || (now - new Date(lastAlert)) > 2 * 60 * 60 * 1000) {
            const message = `LINK DOWN: ${device.name} x ${failure.neighbor_name} | ${failure.interface} | State: Down since ${toEATString(timestamp)}`;
            await sendSms(message);
            // Push notification to all users
            const tokens = await sendPushNotification.getAllTokens();
            await sendPushNotification(tokens, "ISIS Link Down", message);
            // Update last_down_alert_sent
            await IsisAdjacency.update(
              { last_down_alert_sent: now },
              { where: { id: failure.id } }
            );
            console.log(`[Alert] Down SMS & Push sent for ${failure.interface}`);
          }
        }

        // --- 9. Send alerts for recoveries (with duration) ---
        for (const rec of recoveries) {
          const prev = rec.previous;
          const lastAlert = prev.last_up_alert_sent;
          const now = new Date();
          if (!lastAlert || (now - new Date(lastAlert)) > 2 * 60 * 60 * 1000) {
            const downTime = new Date(prev.last_checked);
            const duration = formatDuration(downTime, now);
            const message = `LINK UP: ${device.name} x ${prev.neighbor_name} | ${prev.interface} | UP after ${duration} (was down since ${toEATString(downTime)})`;
            await sendSms(message);
            await IsisAdjacency.update(
              { last_up_alert_sent: now },
              { where: { id: prev.id } }
            );
            console.log(`[Alert] Up SMS sent for ${prev.interface}`);
          }
        }

        // --- 10. High Traffic alerts (for Up links, utilisation >80%, cooldown 2h) ---
        const now = new Date();
        const highTrafficLinks = await IsisAdjacency.findAll({
          where: {
            local_device_id: device.id,
            state: "Up",
            port_speed: { [Op.ne]: null },
            input_bps: { [Op.ne]: null },
            output_bps: { [Op.ne]: null },
          },
        });

        for (const link of highTrafficLinks) {
          const util = computeUtilization(link.input_bps, link.output_bps, link.port_speed);
          if (util && util > 80) {
            const lastAlert = link.last_high_traffic_alert;
            if (!lastAlert || (now - new Date(lastAlert)) > 2 * 60 * 60 * 1000) {
              const message = `HIGH TRAFFIC: ${device.name} > ${link.neighbor_name} | ${link.interface} | Utilisation ${util.toFixed(1)}% (>80%) | Speed: ${link.port_speed} Mbps`;
              await sendSms(message);
              await IsisAdjacency.update(
                { last_high_traffic_alert: now },
                { where: { id: link.id } }
              );
              console.log(`[Alert] High traffic SMS sent for ${link.interface} (${util.toFixed(1)}%)`);
            }
          }
        }

        io.emit("isis-update", { device: device.name, adjacency: adjacencies });
        console.log(`[ISIS] ✓ ${device.name} updated with alerts`);

      } catch (err) {
        console.error(`[ISIS] ✗ ${device.ip}: ${err.message}`);
      }
    }
    } finally {
      await db.sequelize.query("SELECT RELEASE_LOCK('isis_adjacent_cron')");
    }
  };

  cron.schedule("*/2 * * * *", () => {
    checkAdjacency().catch(console.error);
  });

  return { checkAdjacency };
};