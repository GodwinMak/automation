const cron = require("node-cron");
const { Client } = require("ssh2");
const { execFile } = require("child_process");
const db = require("../Models");
const pLimit = require("p-limit").default;
const { withLock } = require("../utils/cronLock");
const { computeAllL2VPNCircuits } = require("../Controller/l2vpnCircuit.js");
const { trackStatusChanges } = require("../utils/statusTracker.js");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

// Skip re-checking a device for L2VPN customers for 6 hours after it comes
// back with zero matches — most of the device fleet has none, and walking
// every interface/unit found in step B is comparatively expensive.
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 2,
  };

  const Device = db.devices;
  const L2vpnInterface = db.l2vpninterfaces;
  const L2vpnCircuit = db.l2vpncircuits;
  const L2vpnDeviceSkip = db.l2vpndeviceskips;
  const L2vpnVplsId = db.l2vpnvplsids;

  // PE devices that terminate some customer L2 circuits into a VPLS
  // mesh-group instead of a plain point-to-point l2circuit — Controller/
  // l2vpnCircuit.js keeps its own copy of this same set (kept in sync
  // manually, same pattern as Controller/upgrade.js vs utils/junosUpgrade.js)
  // to decide whether a circuit pointing at one of these is a real VPLS
  // termination worth surfacing, or a plain unconfirmed orphan.
  const PE_VPLS_DEVICES = new Set(["LTZ-PE1-RAH", "LTZ-PE1-TIG"]);

  // === HELPER FUNCTIONS ===

  // Run a single command over its own SSH connection (step A — one command
  // per device).
  const runCommand = (host, cmd) => {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let result = "";
      conn
        .on("ready", () => {
          conn.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            stream
              .on("data", (data) => {
                result += data.toString();
              })
              .on("close", () => {
                conn.end();
                resolve(result.trim());
              });
          });
        })
        .on("error", (err) => reject(err))
        .connect({ host, ...sshConfig });
    });
  };

  // Run many commands over one SSH session (step B — one command per
  // interface/unit found on the device), keyed so each result can be
  // matched back to the row it came from. Modeled on
  // isisAdjacent.js's runCommandsInSession.
  const runCommandsInSessionKeyed = (host, commandEntries) =>
    new Promise((resolve, reject) => {
      const conn = new Client();
      const results = new Map();
      conn
        .on("ready", async () => {
          try {
            for (const { key, cmd } of commandEntries) {
              const output = await new Promise((resCmd, rejCmd) => {
                let data = "";
                conn.exec(cmd, (err, stream) => {
                  if (err) return rejCmd(err);
                  stream
                    .on("data", (d) => {
                      data += d.toString();
                    })
                    .on("close", () => resCmd(data.trim()));
                });
              });
              results.set(key, output);
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

  // Cheap reachability check before paying for a full SSH connection. A
  // dead/unreachable device otherwise costs the full sshConfig.readyTimeout
  // (15s) in runCommand/runCommandsInSessionKeyed before failing — with
  // pLimit(10) that's a queue slot tied up for the whole timeout per bad
  // device, which was the main driver behind step A's multi-minute runtime
  // across the full fleet. Same fix isisAdjacent.js uses for the same problem.
  const isReachable = (host) =>
    new Promise((resolve) => {
      execFile("ping", ["-c", "1", "-W", "2", host], { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });

  // A handful of devices have an interface whose description matches
  // "l2vpn" for reasons unrelated to an actual L2VPN customer circuit
  // (e.g. an uplink/trunk port between access switches) — excluded here
  // via Junos's own "| except <interface>" so it never gets pulled in
  // step A in the first place. Keyed by device name; add more entries as
  // more of these turn up.
  const DEVICE_COMMAND_EXCLUDES = {
    "LTZ-ACC2-RAH": ["ge-0/0/63"],
    "LTZ-ACC3-RAH": ["ge-0/0/36"],
  };

  const buildDescriptionsCommand = (deviceName) => {
    const excludes = DEVICE_COMMAND_EXCLUDES[deviceName] || [];
    return excludes.reduce(
      (cmd, iface) => `${cmd} | except ${iface}`,
      "show interfaces descriptions | match l2vpn",
    );
  };

  // PE and BNG devices don't carry L2VPN access-side circuits — devices.js
  // has no role column, so this matches the same naming convention the
  // hardcoded pe/p/bng arrays in updateIPT.js and updateFTTH.js rely on
  // (e.g. LTZ-PE1-RAH, LDJ-PE2-JIB, LTZ-BNG01-RAH-DAR).
  const isPeOrBng = (name) => /BNG/i.test(name);

  // Pull a customer name out of a Junos description using the same
  // tolerant key=value scan updateIPT.js's parseCustomerInfo uses, falling
  // back to the raw description text so no row is silently dropped while
  // the real L2VPN description format is still being validated.
  //
  // Different device/fleet operators tag the customer under different
  // keys — seen in the wild: Customer=, CNAME= (customer short name), and
  // provider= (used when there's no dedicated customer field at all, e.g.
  // a wholesale/backhaul circuit). Checked in that priority order; EUSER
  // (end user) is deliberately NOT included here — CNAME wins over it
  // whenever both are present.
  const extractCustomerName = (description) => {
    if (!description) return null;

    const attributes = {};
    const regex = /(\w+)\s*=\s*([^|]+)/gi;
    let match;
    while ((match = regex.exec(description)) !== null) {
      attributes[match[1].toLowerCase()] = match[2].trim();
    }

    let customerName =
      attributes["customer"] ||
      attributes["cust"] ||
      attributes["cname"] ||
      attributes["provider"] ||
      null;

    if (!customerName) {
      const orphanCust = description.match(/\|([^|=]+)\|/);
      if (orphanCust) customerName = orphanCust[1].trim();
    }

    return customerName;
  };

  // Parse "show interfaces descriptions | match l2vpn" output into rows.
  // Junos columns are: Interface  Admin  Link  Description.
  const parseL2VPNDescriptions = (output, device) => {
    if (!output) return [];

    const parsedRows = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.match(/^(\S+)\s+(up|down)\s+(up|down)\s*(.*)$/i))
      .filter(Boolean)
      .map((match) => {
        const [, ifaceUnit, adminStatus, operationalStatus, description] = match;
        const dotIndex = ifaceUnit.indexOf(".");
        const isBare = dotIndex === -1;
        const interfaceName = isBare ? ifaceUnit : ifaceUnit.slice(0, dotIndex);
        const unit = isBare ? "0" : ifaceUnit.slice(dotIndex + 1);

        return {
          deviceId: device.id,
          switchName: device.name,
          interface: interfaceName,
          unit,
          isBare,
          customerName: extractCustomerName(description) || description || null,
          adminStatus: adminStatus.toLowerCase(),
          operationalStatus: operationalStatus.toLowerCase(),
        };
      });

    // Junos sometimes lists the same physical circuit twice: once as the
    // bare interface with no unit (implied unit 0, usually a bare/minimal
    // description) and again as the actual tagged unit carrying the real
    // customer description — e.g. "ge-0/0/27" + "ge-0/0/27.3030" for the
    // same Ali-Lalji-Res circuit. That bare line is a duplicate of the
    // tagged one, not a second circuit, so it's dropped whenever a tagged
    // sibling exists on the same interface. A bare line with no tagged
    // sibling (e.g. "ge-0/0/29", nothing else on that port) is a genuine
    // standalone unit-0 circuit and is kept as-is.
    const taggedInterfaces = new Set(
      parsedRows.filter((r) => !r.isBare).map((r) => r.interface),
    );

    return parsedRows
      .filter((r) => !(r.isBare && taggedInterfaces.has(r.interface)))
      .map(({ isBare, ...row }) => row);
  };

  // Scan for a "NN-MBPS"/"NN-GBPS" token on a line that also mentions the
  // given direction (input/output) — covers both the layer2-policer naming
  // convention (parseInterfaceCid/parsePolicerOutput in updateIPT.js) and
  // the plain firewall-filter naming the user described.
  const parseMbpsForDirection = (output, direction) => {
    const lines = output.split("\n");
    const directionRe = new RegExp(direction, "i");
    for (const line of lines) {
      if (!directionRe.test(line)) continue;
      const match = line.match(/(\d+)-?([mMgG])bps/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const unitChar = match[2].toLowerCase();
        return unitChar === "g" ? num * 1000 : num;
      }
    }
    return null;
  };

  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Parse "show configuration | display set | match <interface> | match
  // <unit>" output. NOTE: despite the command targeting one interface/unit,
  // Junos's `| match` is a plain per-line substring grep — a line that
  // belongs to a DIFFERENT unit on the same interface can still pass both
  // filters if the target unit number happens to appear as some other value
  // on that line (e.g. "set interfaces ge-0/0/0 unit 662 vlan-id 1728"
  // passes a "match 1728" filter meant for unit 1728, because 1728 is the
  // *vlan-id value* there, not the unit). So every field is extracted only
  // from lines that actually name this exact interface+unit, either as
  // "interfaces <iface> unit <unit>" (the interfaces stanza) or "interface
  // <iface>.<unit>" (the protocols l2circuit stanza) — never from the raw
  // unscoped output.
  const parseCircuitConfig = (output, interfaceName, unit) => {
    if (!output || !interfaceName || unit === undefined || unit === null) return {};
    const result = {};

    const escapedIface = escapeRegex(interfaceName);
    const escapedUnit = escapeRegex(unit);
    const unitLineRe = new RegExp(
      `interfaces\\s+${escapedIface}\\s+unit\\s+${escapedUnit}\\b|interface\\s+${escapedIface}\\.${escapedUnit}\\b`,
      "i",
    );
    const scopedOutput = output
      .split("\n")
      .filter((line) => unitLineRe.test(line))
      .join("\n");
    if (!scopedOutput) return {};

    const vcMatch = scopedOutput.match(/virtual-circuit-id\s+(\d+)/i);
    if (vcMatch) result.virtualCircuitId = vcMatch[1];

    const vlanMatch = scopedOutput.match(/vlan-id\s+(\d+)/i);
    if (vlanMatch) result.vlanId = vlanMatch[1];

    // Raw far-end IP off "set protocols l2circuit neighbor <ip> interface
    // ...". Resolved against known device IPs by the caller (fetchCircuitDetails),
    // which has the devices table available — this function only parses text.
    const neighborMatch = scopedOutput.match(
      /neighbor\s+(\d{1,3}(?:\.\d{1,3}){3})\s+interface/i,
    );
    if (neighborMatch) result.neighborIp = neighborMatch[1];

    // Junos protection circuits add "... backup-neighbor <ip> virtual-circuit-id
    // ...\" on the same protocols line as the primary neighbor above — a
    // second far-end IP to resolve against devices.ip, same as neighborIp.
    const backupNeighborMatch = scopedOutput.match(
      /backup-neighbor\s+(\d{1,3}(?:\.\d{1,3}){3})/i,
    );
    if (backupNeighborMatch) result.backupNeighborIp = backupNeighborMatch[1];

    const inputMbps = parseMbpsForDirection(scopedOutput, "input");
    if (inputMbps !== null) result.inputMbps = inputMbps;

    const outputMbps = parseMbpsForDirection(scopedOutput, "output");
    if (outputMbps !== null) result.outputMbps = outputMbps;

    return result;
  };

  // Parses "show configuration | display set | match vpls-id" output — every
  // "set routing-instances <name> protocols vpls mesh-group <name> vpls-id
  // <N>" line on a PE — into the set of vpls-id values configured there. An
  // access-side l2circuit whose virtualCircuitId equals one of these is
  // actually terminating into that PE's VPLS mesh-group, not a plain
  // point-to-point circuit to another device.
  const parseVplsIds = (output) => {
    if (!output) return [];
    const ids = new Set();
    const re = /vpls-id\s+(\d+)/gi;
    let match;
    while ((match = re.exec(output)) !== null) {
      ids.add(match[1]);
    }
    return [...ids];
  };

  // === STEP B: circuit config detail for one device ===
  const fetchCircuitDetails = async (device, neighborNameByIp) => {
    try {
      const reachable = await isReachable(device.ip);
      if (!reachable) {
        console.warn(
          `[L2VPN Circuits] ⚠ ${device.name} (${device.ip}) not reachable via ping — skipping this cycle.`,
        );
        return;
      }

      const interfaceRows = await L2vpnInterface.findAll({
        where: { deviceId: device.id },
        raw: true,
      });
      if (interfaceRows.length === 0) return;

      const commandEntries = interfaceRows.map((row) => ({
        key: row.id,
        cmd: `show configuration | display set | match ${row.interface} | match ${row.unit}`,
      }));

      const outputs = await runCommandsInSessionKeyed(device.ip, commandEntries);

      for (const row of interfaceRows) {
        const parsed = parseCircuitConfig(outputs.get(row.id), row.interface, row.unit);
        if (Object.keys(parsed).length === 0) continue;

        if (parsed.neighborIp) {
          parsed.neighbor = neighborNameByIp.get(parsed.neighborIp) || parsed.neighborIp;
          delete parsed.neighborIp;
        }
        if (parsed.backupNeighborIp) {
          parsed.backupNeighbor = neighborNameByIp.get(parsed.backupNeighborIp) || parsed.backupNeighborIp;
          delete parsed.backupNeighborIp;
        }

        const existing = await L2vpnCircuit.findOne({
          where: { l2vpnInterfaceId: row.id },
        });
        if (existing) {
          await existing.update(parsed);
        } else {
          await L2vpnCircuit.create({ l2vpnInterfaceId: row.id, ...parsed });
        }
      }

      console.log(
        `[L2VPN Circuits] ${device.name}: circuit config detail updated for ${interfaceRows.length} interfaces.`,
      );
    } catch (err) {
      console.error(
        `[L2VPN Circuits] ✗ ${device.name} (${device.ip}) circuit detail fetch failed: ${err.message}`,
      );
    }
  };

  // Refreshes the known vpls-id set for each PE in PE_VPLS_DEVICES. Runs
  // independently of the per-device l2vpn-interface-discovery loop below
  // (which early-returns for a device with zero l2vpn-tagged interfaces —
  // exactly the case for these PEs, since their customer-facing circuits
  // are tagged "cat=MGMT" or similar, never "cat=L2VPN", so that loop would
  // never reach this data otherwise). One command per PE gets every
  // mesh-group's vpls-id in a single pass, rather than one command per
  // circuit.
  const updateVplsMeshGroups = async (allDevices) => {
    const peDevices = allDevices.filter((d) => PE_VPLS_DEVICES.has(d.name));
    await Promise.all(
      peDevices.map(async (device) => {
        try {
          const reachable = await isReachable(device.ip);
          if (!reachable) {
            console.warn(
              `[L2VPN VPLS] ⚠ ${device.name} (${device.ip}) not reachable via ping — skipping this cycle.`,
            );
            return;
          }

          const output = await runCommand(
            device.ip,
            "show configuration | display set | match vpls-id",
          );
          const vplsIds = parseVplsIds(output);
          const seen = new Set(vplsIds);

          // Same stale-row cleanup shape as the interface discovery loop
          // below — a mesh-group removed from the PE's config should stop
          // being treated as a valid VPLS termination on the next poll.
          const existing = await L2vpnVplsId.findAll({
            where: { deviceId: device.id },
            attributes: ["id", "vplsId"],
            raw: true,
          });
          const staleIds = existing
            .filter((row) => !seen.has(row.vplsId))
            .map((row) => row.id);
          if (staleIds.length > 0) {
            await L2vpnVplsId.destroy({
              where: { id: { [db.Sequelize.Op.in]: staleIds } },
            });
          }

          if (vplsIds.length > 0) {
            await L2vpnVplsId.bulkCreate(
              vplsIds.map((vplsId) => ({
                deviceId: device.id,
                switchName: device.name,
                vplsId,
              })),
              { ignoreDuplicates: true },
            );
          }

          console.log(
            `[L2VPN VPLS] ${device.name}: ${vplsIds.length} vpls-id mesh-group(s) recorded.`,
          );
        } catch (err) {
          console.error(
            `[L2VPN VPLS] ✗ ${device.name} (${device.ip}) vpls-id fetch failed: ${err.message}`,
          );
        }
      }),
    );
  };

  // === MAIN UPDATER FUNCTION ===
  const updateL2VPN = async () => {
    console.log(`\n[L2VPN Updater] Started at ${new Date().toISOString()}`);

    try {
      const [allDevices, skipRows] = await Promise.all([
        Device.findAll({ raw: true }),
        L2vpnDeviceSkip.findAll({ raw: true }),
      ]);

      const skipMap = new Map(skipRows.map((s) => [s.deviceId, s.lastNoDataAt]));
      const now = Date.now();

      // === Step 0: load all devices except PE/BNG and 6h-skipped ones ===
      const candidates = allDevices.filter((d) => {
        if (isPeOrBng(d.name)) return false;
        const skippedAt = skipMap.get(d.id);
        if (skippedAt && now - new Date(skippedAt).getTime() < SIX_HOURS_MS) {
          return false;
        }
        return true;
      });

      console.log(
        `[L2VPN Updater] ${candidates.length}/${allDevices.length} devices eligible for interface discovery.`,
      );

      const limit = pLimit(10);

      // === Step A: interface/customer discovery ===
      // Circuit config detail (step B) is intentionally NOT run from here
      // any more — it's the expensive half (one SSH command per
      // interface/unit found) and doesn't need this cadence, since
      // circuit-id/vlan-id/capacity change far less often than interface
      // up/down + customer descriptions do. See updateL2VPNCircuits below,
      // which runs on its own hourly schedule instead.
      //
      // Runs concurrently with updateVplsMeshGroups (PE vpls-id refresh) —
      // the two touch entirely different devices/tables, so there's no
      // reason to serialize them.
      const interfaceDiscovery = Promise.all(
        candidates.map((device) =>
          limit(async () => {
            try {
              const reachable = await isReachable(device.ip);
              if (!reachable) {
                console.warn(
                  `[L2VPN Updater] ⚠ ${device.name} (${device.ip}) not reachable via ping — skipping this cycle.`,
                );
                return;
              }

              const output = await runCommand(
                device.ip,
                buildDescriptionsCommand(device.name),
              );
              const rows = parseL2VPNDescriptions(output, device);

              if (rows.length === 0) {
                await L2vpnDeviceSkip.upsert({
                  deviceId: device.id,
                  lastNoDataAt: new Date(),
                });
                console.log(
                  `[L2VPN Updater] ${device.name}: no L2VPN customers found, skipping for 6h.`,
                );
                return;
              }

              // Data found again — clear any previous skip so it's no
              // longer excluded on the next run.
              await L2vpnDeviceSkip.destroy({ where: { deviceId: device.id } });

              // Purge stale bare-unit-0 rows left over from BEFORE
              // parseL2VPNDescriptions started dropping them (see the
              // bare-vs-tagged dedupe above) — e.g. a previously-stored
              // "ge-0/0/27" unit-0 phantom row for an interface that now
              // has a real tagged unit ("ge-0/0/27.3030" in the current
              // output). `rows` already excludes this run's bare
              // duplicates, so bulkCreate below would never touch/replace
              // that old row — it has to be deleted explicitly, once, or
              // it lingers forever as a bogus "needs-review" circuit.
              // Cascades to its l2vpncircuits row via the FK's ON DELETE
              // CASCADE. Interfaces with only a genuine standalone unit-0
              // circuit (no tagged sibling in the current output) are not
              // in this set and are left untouched.
              const taggedInterfacesNow = new Set(
                rows.filter((r) => r.unit !== "0").map((r) => r.interface),
              );
              if (taggedInterfacesNow.size > 0) {
                await L2vpnInterface.destroy({
                  where: {
                    deviceId: device.id,
                    unit: "0",
                    interface: { [db.Sequelize.Op.in]: [...taggedInterfacesNow] },
                  },
                });
              }

              // Clean up interfaces that vanished from this poll's `show
              // interfaces descriptions | match l2vpn` output entirely — a
              // circuit decommissioned/removed on the device would
              // otherwise linger in the DB forever, since bulkCreate below
              // only upserts rows still present and never removes ones that
              // aren't. Cascades to its l2vpncircuits row via the FK's ON
              // DELETE CASCADE. Scoped to this device and gated behind the
              // `rows.length === 0` guard above, same as the bare-unit-0
              // purge, so a parsing failure or empty output can never wipe
              // out a device's real data.
              const seenKeys = new Set(rows.map((r) => `${r.interface}::${r.unit}`));
              const existingInterfaces = await L2vpnInterface.findAll({
                where: { deviceId: device.id },
                attributes: ["id", "interface", "unit"],
                raw: true,
              });
              const staleIds = existingInterfaces
                .filter((row) => !seenKeys.has(`${row.interface}::${row.unit}`))
                .map((row) => row.id);
              if (staleIds.length > 0) {
                await L2vpnInterface.destroy({
                  where: { id: { [db.Sequelize.Op.in]: staleIds } },
                });
                console.log(
                  `[L2VPN Updater] ${device.name}: removed ${staleIds.length} stale interface(s) no longer in device config.`,
                );
              }

              await L2vpnInterface.bulkCreate(rows, {
                updateOnDuplicate: [
                  "customerName",
                  "adminStatus",
                  "operationalStatus",
                  "switchName",
                ],
              });

              console.log(
                `[L2VPN Updater] ${device.name}: ${rows.length} L2VPN interfaces stored.`,
              );
            } catch (err) {
              console.error(
                `[L2VPN Updater] ✗ ${device.name} (${device.ip}) interface discovery failed: ${err.message}`,
              );
            }
          }),
        ),
      );

      await Promise.all([interfaceDiscovery, updateVplsMeshGroups(allDevices)]);

      await trackL2VPNCircuitStatusChanges();
    } catch (err) {
      console.error("[L2VPN Updater] Fatal error:", err.message);
    }
    console.log("[L2VPN Updater] Finished run.\n");
  };

  // === Churn/status-history tracking for L2VPN circuits ===
  // Runs every 5-minute cycle (same cadence as step A, since operationalStatus
  // — the field that actually drives a circuit's up/down/mixed state — is
  // refreshed there, not in the hourly step B config-detail pass). Recomputes
  // the full clustered circuit view fresh from current DB state (picking up
  // whatever step A just wrote) and diffs it against trackStatusChanges'
  // in-memory cache the exact same way DIA/IPT/SHARED/L3VPN do, so L2VPN gets
  // the same churn-risk/downtime tracking, notifications, and history rows.
  //
  // Tracked identity: a circuit's first hop's virtualCircuitId. This is
  // stable (tied to real Junos config) and, since clustering itself groups
  // rows by matching virtualCircuitId+vlanId, every hop in one circuit
  // already shares the same vcid — EXCEPT in the rare case where duplicate
  // config causes buildCircuits to split one vcid+vlan cluster into more
  // than one circuit (a data-quality issue, not a code bug); those would
  // collide on this identity and the last one processed wins. Acceptable
  // for now — flagged here rather than solved, since it's the same
  // duplicate-vcid case already surfaced to the user as a device-config
  // issue worth their own investigation.
  const trackL2VPNCircuitStatusChanges = async () => {
    try {
      const circuits = await computeAllL2VPNCircuits();
      if (circuits.length === 0) return;

      const interfaces = [];
      const customerInfoMap = {};
      for (const circuit of circuits) {
        const key = circuit.hops[0]?.virtualCircuitId;
        if (!key) continue;
        interfaces.push({
          interface: key,
          operationalStatus: circuit.overallOperationalStatus,
          switchName: circuit.hops[0]?.switchName || null,
        });
        customerInfoMap[key] = {
          // Unlike DIA/IPT/Shared/L3VPN, there's no customerinfos-style row
          // to key off — virtualCircuitId (key) is the only stable identity
          // a circuit has, so it doubles as both the watch-list customerId
          // and the displayed "CID" (see Favorite/Notification, which just
          // need a stable string key, not a real DB row id).
          id: key,
          customerName: circuit.customerName,
          cid: key,
          nbr: circuit.hops[0]?.neighbor || null,
        };
      }

      await trackStatusChanges(interfaces, "L2VPN", customerInfoMap);
    } catch (err) {
      console.error("[L2VPN Updater] Status-history tracking failed:", err.message);
    }
  };

  // === STEP B RUNNER: circuit config detail ===
  // Deliberately decoupled from updateL2VPN's per-run results — walks
  // every device currently known (from l2vpninterfaces) to have L2VPN
  // interfaces, so it stays correct even though it's no longer triggered
  // from inside the same run that discovered them.
  const updateL2VPNCircuits = async () => {
    console.log(`\n[L2VPN Circuits] Started at ${new Date().toISOString()}`);

    try {
      const deviceIdRows = await L2vpnInterface.findAll({
        attributes: [
          [db.Sequelize.fn("DISTINCT", db.Sequelize.col("deviceId")), "deviceId"],
        ],
        raw: true,
      });
      const deviceIds = deviceIdRows.map((r) => r.deviceId);

      if (deviceIds.length === 0) {
        console.log("[L2VPN Circuits] No devices with L2VPN interfaces yet — nothing to do.");
        return;
      }

      const devices = await Device.findAll({ where: { id: deviceIds }, raw: true });
      console.log(
        `[L2VPN Circuits] Fetching circuit config detail for ${devices.length} devices...`,
      );

      // Built from the FULL device table (not just `devices` above) since a
      // circuit's l2circuit neighbor is very often a PE/BNG — which step A
      // deliberately excludes from polling, but which can still be a known
      // device worth resolving by name here.
      const allDevices = await Device.findAll({ raw: true });
      const neighborNameByIp = new Map(allDevices.map((d) => [d.ip, d.name]));

      const limit = pLimit(10);
      await Promise.all(
        devices.map((device) => limit(() => fetchCircuitDetails(device, neighborNameByIp))),
      );
    } catch (err) {
      console.error("[L2VPN Circuits] Fatal error:", err.message);
    }
    console.log("[L2VPN Circuits] Finished run.\n");
  };

  const runAll = async () => {
    await withLock("l2vpn_cron_update", async () => {
      try {
        await updateL2VPN();
      } catch (err) {
        console.error("[Main Runner] Fatal error:", err.message);
      }
    });
  };

  const runCircuitsAll = async () => {
    await withLock("l2vpn_circuit_cron_update", async () => {
      try {
        await updateL2VPNCircuits();
      } catch (err) {
        console.error("[Circuit Runner] Fatal error:", err.message);
      }
    });
  };

  // options.job selects which schedule(s) this call registers, so the two
  // jobs can run as separate PM2 processes (see cron-runner.js's "L2VPN"
  // and "L2VPNCircuits" cases) instead of sharing one process's event loop
  // and SSH concurrency — running both together meant the heavy hourly
  // circuit walk and the frequent interface poll competed for the same
  // resources whenever they landed in the same tick. Unset (e.g. a manual
  // require elsewhere) schedules both, preserving the old combined behavior.
  if (options.schedule !== false) {
    const job = options.job;
    if (job !== "circuits") {
      cron.schedule("*/5 * * * *", runAll);
      console.log("[L2VPN] Interface discovery cron job scheduled every 5 minutes.");
    }
    if (job !== "interfaces") {
      // 3-minute offset so this never lands on the same tick as the */5
      // interface job above (same reasoning as updateFTTH.js/updateIPT.js's
      // schedule offsets).
      cron.schedule("3 * * * *", runCircuitsAll);
      console.log(
        "[L2VPN] Circuit config detail cron job scheduled every hour (offset 3 min past the hour).",
      );
    }
  }

  return {
    updateL2VPN,
    updateL2VPNCircuits,
  };
};
