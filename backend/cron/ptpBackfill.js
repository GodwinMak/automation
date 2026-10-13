const { Client } = require("ssh2");
const { Op } = require("sequelize");
const pLimit = require("p-limit").default;
const db = require("../Models");
const { withLock } = require("../utils/cronLock");

const IsisAdjacency = db.isisAdjacency;
const Devices = db.devices;

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (_io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 30000,
  };

  const runCommandsInSession = (host, commands) =>
    new Promise((resolve, reject) => {
      const conn = new Client();
      const results = [];
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        try {
          conn.end();
        } catch (_e) {}
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const connectTimer = setTimeout(() => {
        fail(new Error(`SSH connect timeout to ${host}`));
      }, 35000);

      conn
        .on("ready", async () => {
          clearTimeout(connectTimer);
          try {
            for (const cmd of commands) {
              const res = await new Promise((resCmd, rejCmd) => {
                let data = "";
                conn.exec(cmd, (err, stream) => {
                  if (err) return rejCmd(err);

                  const cmdTimer = setTimeout(() => {
                    try {
                      stream.close();
                    } catch (_e) {}
                    rejCmd(new Error(`SSH command timeout on ${host}: ${cmd}`));
                  }, 30000);

                  stream
                    .on("data", (d) => {
                      data += d.toString();
                    })
                    .on("close", () => {
                      clearTimeout(cmdTimer);
                      resCmd(data.trim());
                    })
                    .on("error", (streamErr) => {
                      clearTimeout(cmdTimer);
                      rejCmd(streamErr);
                    });
                });
              });
              results.push(res);
            }
            if (settled) return;
            settled = true;
            conn.end();
            resolve(results);
          } catch (err) {
            fail(err);
          }
        })
        .on("error", (err) => {
          clearTimeout(connectTimer);
          fail(err);
        })
        .on("end", () => {
          clearTimeout(connectTimer);
          fail(new Error(`SSH connection ended for ${host}`));
        })
        .on("close", (hadError) => {
          clearTimeout(connectTimer);
          fail(new Error(`SSH connection closed for ${host}${hadError ? " with error" : ""}`));
        })
        .connect({ host, ...sshConfig });
    });

  const parseInetFromLine = (output) => {
    if (!output) return null;

    // Prefer explicit IPv4 inet token from terse output lines like:
    // et-0/0/101.0 up up inet 41.175.46.36/31
    const inetV4 = output.match(/\binet\s+((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2})\b/i);
    if (inetV4) return inetV4[1];

    // Fallback: extract first IPv4 CIDR token if inet keyword is formatted unexpectedly.
    const anyV4Cidr = output.match(/\b((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2})\b/);
    return anyV4Cidr ? anyV4Cidr[1] : null;
  };

  // ISIS adjacencies key off the logical unit (e.g. et-0/0/101.0), but optics
  // diagnostics are a property of the physical port, so strip the ".<unit>".
  const toPhysicalInterface = (rawInterface) => {
    if (!rawInterface) return null;
    return rawInterface.replace(/\.\d+$/, "");
  };

  const dbmFromLine = (line) => {
    const m = line.match(/\/\s*(-?[\d.]+)\s*dBm/i);
    return m ? parseFloat(m[1]) : null;
  };

  // Parses `show interfaces diagnostics optics {iface} | match power` output.
  //
  // Three shapes seen in the field:
  //  - ge/xe (1G/10G): one output + one rx reading, plus 8 threshold lines
  //  - et- (40G/100G): 8 threshold lines once, then 4 repeating lane blocks
  //    of (output power, receiver power, 4x alarm/warning status lines)
  //  - radio-backed links: empty output (no optics to report)
  //
  // Threshold lines always contain the word "threshold". Alarm/warning
  // status lines (Off/On) contain "alarm"/"warning" but not "threshold".
  // Plain current-value lines are just "Laser output power :" / "Laser
  // receiver power :" with nothing else before the colon. Checking in that
  // order (threshold -> status -> value) disambiguates all three.
  const parsePowerDiagnostics = (output) => {
    if (!output) return null;

    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const thresholds = {
      tx_high_alarm_dbm: null,
      tx_low_alarm_dbm: null,
      tx_high_warning_dbm: null,
      tx_low_warning_dbm: null,
      rx_high_alarm_dbm: null,
      rx_low_alarm_dbm: null,
      rx_high_warning_dbm: null,
      rx_low_warning_dbm: null,
    };

    const txReadings = [];
    const rxReadings = [];

    for (const line of lines) {
      if (!/^Laser/i.test(line)) continue;

      // Threshold lines (e.g. "Laser rx power high alarm threshold : ...")
      if (/threshold\s*:/i.test(line)) {
        const dbm = dbmFromLine(line);
        if (dbm === null) continue;

        const isTx = /output power/i.test(line);
        const isRx = /rx power|receiver power/i.test(line);
        const isHigh = /high/i.test(line);
        const isAlarm = /alarm/i.test(line);

        if (isTx) {
          if (isHigh && isAlarm) thresholds.tx_high_alarm_dbm = dbm;
          else if (!isHigh && isAlarm) thresholds.tx_low_alarm_dbm = dbm;
          else if (isHigh && !isAlarm) thresholds.tx_high_warning_dbm = dbm;
          else thresholds.tx_low_warning_dbm = dbm;
        } else if (isRx) {
          if (isHigh && isAlarm) thresholds.rx_high_alarm_dbm = dbm;
          else if (!isHigh && isAlarm) thresholds.rx_low_alarm_dbm = dbm;
          else if (isHigh && !isAlarm) thresholds.rx_high_warning_dbm = dbm;
          else thresholds.rx_low_warning_dbm = dbm;
        }
        continue;
      }

      // Alarm/warning status lines (Off/On) - not a threshold, not a reading.
      if (/(alarm|warning)\s*:/i.test(line)) {
        continue;
      }

      // Plain current-value lines.
      if (/^Laser output power\s*:/i.test(line)) {
        const dbm = dbmFromLine(line);
        if (dbm !== null) txReadings.push(dbm);
        continue;
      }
      if (/^Laser (receiver power|rx power)\s*:/i.test(line)) {
        const dbm = dbmFromLine(line);
        if (dbm !== null) rxReadings.push(dbm);
        continue;
      }
    }

    if (txReadings.length === 0 && rxReadings.length === 0) return null;

    return {
      tx_power_dbm: JSON.stringify(txReadings),
      rx_power_dbm: JSON.stringify(rxReadings),
      ...thresholds,
    };
  };

  const backfillPointToPointIps = async () => {
    await withLock("isis_ptp_backfill_cron", async () => {
      const missingAdjacencies = await IsisAdjacency.findAll({
        attributes: ["local_device_id", "raw_interface"],
        where: {
          point_to_point_ip: { [Op.is]: null },
          state: "Up",
        },
        raw: true,
        nest: true,
        include: [
          {
            model: Devices,
            attributes: ["ip", "name"],
            required: true,
            as: "device",
          },
        ],
      });
      console.log(`[ISIS-PTP] rows with NULL point_to_point_ip: ${missingAdjacencies.length}`);

      const missingByDevice = new Map();
      for (const row of missingAdjacencies) {
        const localDeviceId = row.local_device_id;
        const deviceIp = row.device?.ip;
        const deviceName = row.device?.name;
        if (!deviceIp) continue;

        const key = localDeviceId;
        if (!missingByDevice.has(key)) {
          missingByDevice.set(key, {
            local_device_id: localDeviceId,
            device_ip: deviceIp,
            device_name: deviceName,
            raw_interfaces: new Set(),
          });
        }
        missingByDevice.get(key).raw_interfaces.add(row.raw_interface);
      }

      console.log(`[ISIS-PTP] devices queued for backfill: ${missingByDevice.size}`);

      let updatedCount = 0;

      for (const group of missingByDevice.values()) {
        try {
          const rawInterfaces = Array.from(group.raw_interfaces);
          console.log(`[ISIS-PTP] processing device: ${group.device_name || group.device_ip}`);
          for (const rawIface of rawInterfaces) {
            console.log(`[ISIS-PTP] processing interface: ${rawIface}`);
            const [ptpResult] = await runCommandsInSession(group.device_ip, [
              `show interfaces ${rawIface} terse | match inet`,
            ]);
            console.log(`[ISIS-PTP] ${group.device_name || group.device_ip} :: show interfaces ${rawIface} terse | match inet`);
            console.log(`[ISIS-PTP] output for ${rawIface}:\n${ptpResult || "<empty>"}`);

            const ipCidr = parseInetFromLine(ptpResult);

            if (!ipCidr) continue;

            await IsisAdjacency.update(
              { point_to_point_ip: ipCidr },
              {
                where: {
                  local_device_id: group.local_device_id,
                  raw_interface: rawIface,
                  point_to_point_ip: { [Op.is]: null },
                },
              },
            );
            updatedCount += 1;
          }
        } catch (err) {
          console.error(
            `[ISIS-PTP] Backfill failed for ${group.device_name || group.device_ip}: ${err.message}`,
          );
        }
      }
      console.log(`[ISIS-PTP] backfill run complete. Updated interfaces: ${updatedCount}`);
    });
  };

  const checkOpticsPower = async () => {
    await withLock("isis_optics_power_cron", async () => {
      // Unlike backfillPointToPointIps just above (which already filters
      // state: "Up"), this had no state filter at all — meaning it kept
      // retrying optics diagnostics on links ISIS already knows are Down,
      // forever, with no backoff. A Down link usually can't be SSHed for
      // optics either, so those attempts just eat the full 30-35s SSH
      // handshake timeout every single run (seen in production: ge-0/1/0
      // on LTZ-ACC1-KIS timing out on nearly every cycle).
      const adjacencies = await IsisAdjacency.findAll({
        attributes: ["local_device_id", "raw_interface"],
        where: { state: "Up" },
        raw: true,
        nest: true,
        include: [
          {
            model: Devices,
            attributes: ["ip", "name"],
            required: true,
            as: "device",
          },
        ],
      });
      console.log(`[ISIS-POWER] Up adjacencies to check: ${adjacencies.length}`);

      // Group by device, then by physical interface (several logical units
      // could in theory share one physical port, so dedupe SSH calls).
      const byDevice = new Map();
      for (const row of adjacencies) {
        const deviceIp = row.device?.ip;
        const deviceName = row.device?.name;
        if (!deviceIp) continue;

        const physicalInterface = toPhysicalInterface(row.raw_interface);
        if (!physicalInterface) continue;

        const key = row.local_device_id;
        if (!byDevice.has(key)) {
          byDevice.set(key, {
            local_device_id: row.local_device_id,
            device_ip: deviceIp,
            device_name: deviceName,
            interfaces: new Map(), // physicalInterface -> Set(raw_interface)
          });
        }
        const deviceEntry = byDevice.get(key);
        if (!deviceEntry.interfaces.has(physicalInterface)) {
          deviceEntry.interfaces.set(physicalInterface, new Set());
        }
        deviceEntry.interfaces.get(physicalInterface).add(row.raw_interface);
      }

      console.log(`[ISIS-POWER] devices queued: ${byDevice.size}`);

      let updatedCount = 0;

      // Previously fully sequential — every device, then every physical
      // interface within it, one SSH connection at a time with nothing
      // overlapped. That's what pushed a single run past 34 minutes against
      // a 15-minute reschedule interval. Bounding concurrency at both
      // levels (deviceLimit x interfaceLimit) mirrors the same fix already
      // applied to cron/isisInterfaceStats.js. Each interface still gets
      // its own SSH connection (runCommandsInSession), not a shared one —
      // Junos caps max-sessions-per-connection at 1, confirmed elsewhere in
      // this codebase, so channel multiplexing isn't an option here either.
      const interfaceLimit = pLimit(4);
      const processDeviceGroup = async (group) => {
        console.log(`[ISIS-POWER] processing device: ${group.device_name || group.device_ip}`);
        await Promise.all(
          Array.from(group.interfaces.entries()).map(([physicalInterface, rawInterfaces]) =>
            interfaceLimit(async () => {
              try {
                console.log(`[ISIS-POWER] processing interface: ${physicalInterface}`);
                const [powerResult] = await runCommandsInSession(group.device_ip, [
                  `show interfaces diagnostics optics ${physicalInterface} | match power`,
                ]);
                console.log(
                  `[ISIS-POWER] ${group.device_name || group.device_ip} :: show interfaces diagnostics optics ${physicalInterface} | match power`,
                );
                console.log(`[ISIS-POWER] output for ${physicalInterface}:\n${powerResult || "<empty>"}`);

                const parsed = parsePowerDiagnostics(powerResult);
                if (!parsed) {
                  console.log(`[ISIS-POWER] no power data for ${physicalInterface} (radio link or unreadable)`);
                  return;
                }

                for (const rawIface of rawInterfaces) {
                  await IsisAdjacency.update(
                    { ...parsed, last_power_checked: new Date() },
                    {
                      where: {
                        local_device_id: group.local_device_id,
                        raw_interface: rawIface,
                      },
                    },
                  );
                  updatedCount += 1;
                }
              } catch (err) {
                console.error(
                  `[ISIS-POWER] Interface check failed for ${physicalInterface} on ${group.device_name || group.device_ip}: ${err.message}`,
                );
              }
            })
          )
        );
      };

      const deviceLimit = pLimit(8);
      await Promise.all(
        Array.from(byDevice.values()).map((group) => deviceLimit(() => processDeviceGroup(group)))
      );
      console.log(`[ISIS-POWER] optics power check complete. Updated interfaces: ${updatedCount}`);
    });
  };

  if (options.schedule !== false) {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;

    const runAndReschedule = async () => {
      try {
        await backfillPointToPointIps();
      } catch (err) {
        console.error("[ISIS-PTP] Scheduled run failed:", err.message || err);
      } finally {
        setTimeout(runAndReschedule, ONE_HOUR_MS);
      }
    };

    const runPowerCheckAndReschedule = async () => {
      try {
        await checkOpticsPower();
      } catch (err) {
        console.error("[ISIS-POWER] Scheduled run failed:", err.message || err);
      } finally {
        setTimeout(runPowerCheckAndReschedule, FIFTEEN_MIN_MS);
      }
    };

    runAndReschedule();
    runPowerCheckAndReschedule();
  }

  return { backfillPointToPointIps, checkOpticsPower };
};