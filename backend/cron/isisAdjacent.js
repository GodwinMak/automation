const cron = require("node-cron");
const { Client } = require("ssh2");
const { execFile } = require("child_process");
const db = require("../Models");
const { Op } = require("sequelize");
const pLimit = require("p-limit").default;
const { enqueueBatch } = require("../utils/warehouseSpool");

const { sendSms } = require("../utils/sms");
const sendPushNotification = require("../utils/sendPushNotification");
const { withLock } = require("../utils/cronLock");
const { getIsisAlertRecipients } = require("../utils/notificationRecipients");
const { createIsisAlertNotification } = require("../Controller/notification");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// Helper: Format date in EAT (UTC+3)
const toEATString = (date) => {
  const eatDate = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return eatDate.toLocaleString("en-GB", { hour12: false });
};

// Helper: safely parse the JSON-stringified dBm arrays (tx_power_dbm / rx_power_dbm)
const parsePowerArray = (val) => {
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
};

// Helper: pull optics power + threshold fields off an existing IsisAdjacency
// record (previousAdj or a failure record) so they can be carried through
// to both the DB payload and the warehouse forwarder without this cron job
// (which doesn't do optics polling) ever overwriting them with nulls.
const extractOpticsFields = (rec) => ({
  tx_power_dbm: rec?.tx_power_dbm ?? null,
  rx_power_dbm: rec?.rx_power_dbm ?? null,
  tx_high_alarm_dbm: rec?.tx_high_alarm_dbm ?? null,
  tx_low_alarm_dbm: rec?.tx_low_alarm_dbm ?? null,
  tx_high_warning_dbm: rec?.tx_high_warning_dbm ?? null,
  tx_low_warning_dbm: rec?.tx_low_warning_dbm ?? null,
  rx_high_alarm_dbm: rec?.rx_high_alarm_dbm ?? null,
  rx_low_alarm_dbm: rec?.rx_low_alarm_dbm ?? null,
  rx_high_warning_dbm: rec?.rx_high_warning_dbm ?? null,
  rx_low_warning_dbm: rec?.rx_low_warning_dbm ?? null,
  last_power_checked: rec?.last_power_checked ?? null,
});

// Helper: pull ISIS metric + traffic-stats fields off an existing
// IsisAdjacency record so they can be carried through to the warehouse
// forwarder without this cron (which no longer polls "show isis interface"
// or interface statistics — see cron/isisInterfaceMetric.js and
// cron/isisInterfaceStats.js) ever overwriting them with nulls.
const extractStatsFields = (rec) => ({
  metric: rec?.metric ?? null,
  port_speed: rec?.port_speed ?? null,
  input_bps: rec?.input_bps ?? null,
  output_bps: rec?.output_bps ?? null,
});

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 30000,
  };

  // readyTimeout above only bounds the SSH handshake. Once conn.exec() opens
  // a channel, nothing bounds how long we wait for its "close" event — a
  // device that accepts the exec but never closes the channel leaves this
  // whole promise (and the connection) hanging forever, which is exactly
  // the kind of leaked session that can exhaust a router's limited
  // concurrent SSH session pool and lock out real admins. This watchdog
  // covers each command in the sequence and forces conn.end() on expiry.
  const EXEC_COMMAND_TIMEOUT_MS = 30000;

  const runCommandsInSession = (host, commands) =>
    new Promise((resolve, reject) => {
      const conn = new Client();
      let results = [];
      let isDone = false;

      const finish = (fn, arg) => {
        if (isDone) return;
        isDone = true;
        fn(arg);
      };

      conn
        .on("ready", async () => {
          try {
            for (const cmd of commands) {
              const res = await new Promise((resCmd, rejCmd) => {
                let data = "";
                let cmdDone = false;
                const timeoutTimer = setTimeout(() => {
                  if (cmdDone) return;
                  cmdDone = true;
                  rejCmd(new Error(`Timed out waiting for command output from ${host} (${EXEC_COMMAND_TIMEOUT_MS / 1000}s): ${cmd}`));
                }, EXEC_COMMAND_TIMEOUT_MS);
                conn.exec(cmd, (err, stream) => {
                  if (err) {
                    if (cmdDone) return;
                    cmdDone = true;
                    clearTimeout(timeoutTimer);
                    return rejCmd(err);
                  }
                  stream
                    .on("data", (d) => { data += d.toString(); })
                    .on("close", () => {
                      if (cmdDone) return;
                      cmdDone = true;
                      clearTimeout(timeoutTimer);
                      resCmd(data.trim());
                    });
                });
              });
              results.push(res);
            }
            conn.end();
            finish(resolve, results);
          } catch (err) {
            conn.end();
            finish(reject, err);
          }
        })
        .on("error", (err) => finish(reject, err))
        .connect({ host, ...sshConfig });
    });

  // Cheap reachability check before paying for a full SSH connection. A
  // dead/unreachable device otherwise costs the full 30s readyTimeout in
  // runCommandsInSession before processDevice's catch logs "Timed out
  // while waiting for handshake" — ping fails in ~2s instead, so a bad
  // device no longer eats a slot in the pLimit(10) queue for 30s.
  const isReachable = (host) =>
    new Promise((resolve) => {
      execFile("ping", ["-c", "1", "-W", "2", host], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
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

  // Format duration from down to up (milliseconds)
  const formatDuration = (downTime, upTime) => {
    const diffMs = upTime - downTime;
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const checkAdjacency = async () => {
    await withLock("isis_adjacent_cron", async () => {
    const devices = await Devices.findAll({
      where: { ip: { [Op.notIn]: ["41.175.37.22", "41.175.37.23"] } },
    });

    // SMS recipients are resolved per-link (not once per run) — see
    // getIsisAlertRecipients: a user's isisWatchScope decides whether they
    // get every link's alerts ("all", the default) or only alerts for
    // links they've added to their isis_watchlist.
    const sendIsisSms = async (message, pointToPointIp) => {
      const { phoneNumbers } = await getIsisAlertRecipients(pointToPointIp, "link");
      if (phoneNumbers.length === 0) {
        console.warn("[ISIS] No users configured to receive this link's SMS alerts — skipping SMS.");
        return Promise.resolve();
      }
      return sendSms(message, phoneNumbers);
    };

    const timestamp = new Date();
    const runAdjacencyMap = new Map();

    const processDevice = async (device) => {
      try {
        // --- 0. Skip unreachable devices fast instead of eating the full
        // SSH readyTimeout. Same effective outcome as an SSH timeout today
        // (adjacency rows are left untouched, not marked Down — the
        // device's still-reachable ISIS neighbors are what detect and
        // alert on the drop from their side), just faster to reach.
        const reachable = await isReachable(device.ip);
        if (!reachable) {
          console.warn(`[ISIS] ⚠ ${device.name || device.ip} (${device.ip}) not reachable via ping — skipping this cycle`);
          return;
        }

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
        // Just adjacency status — ISIS metric ("show isis interface") and
        // per-interface traffic stats are polled separately by
        // cron/isisInterfaceMetric.js and cron/isisInterfaceStats.js, which
        // are what actually read metric/port_speed/input_bps/output_bps
        // off the Up rows this job writes. Keeping this to one command per
        // device is what makes the 2-minute schedule below achievable at all.
        const [adjRaw] = await runCommandsInSession(device.ip, ["show isis adjacency"]);

        const adjacencies = parseISISAdjacency(adjRaw);

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
          const prevKey = `${adj.interface}|${adj.neighbor_name}|${adj.level}`;
          const previousAdj = prevMap.get(prevKey);
          const pointToPointIp = previousAdj?.point_to_point_ip || null;
          // Optics power/thresholds and metric/traffic-stats are written by
          // separate pollers, not this cron (see extractOpticsFields and
          // extractStatsFields above). Carry the last known values forward
          // so they ride along in the in-memory map / warehouse payload
          // without this upsert (which doesn't set these columns) ever
          // clobbering them.
          const opticsFields = extractOpticsFields(previousAdj);
          const statsFields = extractStatsFields(previousAdj);

          await IsisAdjacency.upsert({
            local_device_id: device.id,
            neighbor_name: adj.neighbor_name,
            interface: adj.interface,
            raw_interface: adj.raw_interface,
            point_to_point_ip: pointToPointIp,
            level: adj.level,
            state: "Up",
            last_seen: timestamp,
            last_checked: timestamp,
          });

          const recordKey = `${device.id}:${adj.neighbor_name}:${adj.raw_interface}`;
          runAdjacencyMap.set(recordKey, {
            local_device_id: device.id,
            neighbor_name: adj.neighbor_name,
            interface: adj.interface,
            raw_interface: adj.raw_interface,
            point_to_point_ip: pointToPointIp,
            level: adj.level,
            state: "Up",
            ...statsFields,
            ...opticsFields,
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

          const opticsFields = extractOpticsFields(failure);
          const statsFields = extractStatsFields(failure);

          const recordKey = `${failure.local_device_id}:${failure.neighbor_name}:${failure.raw_interface}`;
          runAdjacencyMap.set(recordKey, {
            local_device_id: failure.local_device_id,
            neighbor_name: failure.neighbor_name,
            interface: failure.interface,
            raw_interface: failure.raw_interface,
            point_to_point_ip: failure.point_to_point_ip || null,
            level: failure.level,
            state: "Down",
            ...statsFields,
            ...opticsFields,
          });
        }

        // --- 6b. Reconfirm links that are still Down ---
        // The block above only touches last_checked at the moment a link
        // transitions Up -> Down; a link that's been continuously down
        // since an earlier cycle never gets last_checked refreshed again.
        // Without this, an ongoing, genuinely-down link eventually looks
        // "stale" to the freshness filters in
        // fiberCutDetector.getIsolatedDeviceIds / Controller.getImpactData
        // and gets silently treated as Up — even though we just polled this
        // device and reconfirmed it's still down.
        await IsisAdjacency.update(
          { last_checked: timestamp },
          { where: { local_device_id: device.id, state: "Down" } }
        );

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
            await sendIsisSms(message, failure.point_to_point_ip);
            // Push notification to all users
            const tokens = await sendPushNotification.getAllTokens();
            await sendPushNotification(tokens, "ISIS Link Down", message);
            // In-app notification, scoped by isisWatchScope like the SMS above
            await createIsisAlertNotification({
              pointToPointIp: failure.point_to_point_ip,
              deviceName: device.name,
              neighborName: failure.neighbor_name,
              interfaceName: failure.interface,
              previousStatus: "up",
              currentStatus: "down",
              message,
            });
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
            await sendIsisSms(message, prev.point_to_point_ip);
            await createIsisAlertNotification({
              pointToPointIp: prev.point_to_point_ip,
              deviceName: device.name,
              neighborName: prev.neighbor_name,
              interfaceName: prev.interface,
              previousStatus: "down",
              currentStatus: "up",
              message,
            });
            await IsisAdjacency.update(
              { last_up_alert_sent: now },
              { where: { id: prev.id } }
            );
            console.log(`[Alert] Up SMS sent for ${prev.interface}`);
          }
        }

        if (io && typeof io.emit === "function") {
          io.emit("isis-update", { device: device.name, adjacency: adjacencies });
        }
        console.log(`[ISIS] ✓ ${device.name} updated with alerts`);

      } catch (err) {
        console.error(`[ISIS] ✗ ${device.ip}: ${err.message}`);
      }
    };

    // Devices used to be polled one at a time (2 sequential SSH sessions
    // each, up to 30s timeout apiece) — a single slow/unreachable device
    // stalled the whole ~130-device cycle behind it and held DB pool
    // connections open for API requests the whole time. Bounded concurrency
    // keeps per-device logic identical while letting independent devices
    // make progress in parallel; runAdjacencyMap is a plain Map, safe to
    // share since JS never actually interleaves two synchronous Map.set calls.
    const limit = pLimit(10);
    await Promise.all(devices.map((device) => limit(() => processDevice(device))));

    // High-traffic alerting moved to cron/isisInterfaceStats.js, which is
    // now the job that actually writes fresh port_speed/input_bps/output_bps
    // — this job only carries those columns forward (extractStatsFields).

    const mergedRecords = Array.from(runAdjacencyMap.values()).map((a) => ({
      record_key: `${a.local_device_id}:${a.neighbor_name}:${a.raw_interface}`,
      cid: null,
      poll_ts: new Date(),
      payload: {
        local_device_id: a.local_device_id,
        neighbor_name: a.neighbor_name,
        interface: a.interface,
        raw_interface: a.raw_interface,
        point_to_point_ip: a.point_to_point_ip,
        metric: a.metric,
        port_speed: a.port_speed,
        input_bps: a.input_bps,
        output_bps: a.output_bps,
        level: a.level,
        state: a.state,
        // --- Optics power monitoring ---
        tx_power_dbm: parsePowerArray(a.tx_power_dbm),
        rx_power_dbm: parsePowerArray(a.rx_power_dbm),
        tx_high_alarm_dbm: a.tx_high_alarm_dbm,
        tx_low_alarm_dbm: a.tx_low_alarm_dbm,
        tx_high_warning_dbm: a.tx_high_warning_dbm,
        tx_low_warning_dbm: a.tx_low_warning_dbm,
        rx_high_alarm_dbm: a.rx_high_alarm_dbm,
        rx_low_alarm_dbm: a.rx_low_alarm_dbm,
        rx_high_warning_dbm: a.rx_high_warning_dbm,
        rx_low_warning_dbm: a.rx_low_warning_dbm,
        last_power_checked: a.last_power_checked,
      },
    }));
    enqueueBatch("ISIS", mergedRecords);

    // Now that every device's adjacencies are up to date, check for devices
    // with zero working ISIS adjacencies and force their customers down —
    // see fiberCutDetector.checkDeviceIsolation for why this is needed on
    // top of the normal per-customer-type pollers.
    const { checkDeviceIsolation } = require("../utils/fiberCutDetector");
    await checkDeviceIsolation(timestamp);

    });
  };

  if (options.schedule !== false) {
    // node-cron only fires on the next matching mark, not immediately — on
    // a restart that leaves up to ~2 minutes where last_checked hasn't been
    // reconfirmed yet, so a genuinely-down link can still look "stale" (and
    // get hidden by the freshness filters) until the first tick lands. Kick
    // off one run right away too; withLock still protects against overlap
    // with the scheduled tick or other PM2 cluster workers doing the same.
    checkAdjacency().catch(console.error);
    cron.schedule("*/2 * * * *", () => {
      checkAdjacency().catch(console.error);
    });
  }

  return { checkAdjacency };
};