// Experimental NETCONF-based sibling of isisAdjacent.js — same job (pull
// ISIS adjacency per device), different transport (NETCONF via
// node-netconf instead of SSH CLI text + regex) and different connection
// model (one persistent session per device, reused across poll cycles,
// instead of a fresh SSH connect/exec/disconnect every run).
//
// DRY RUN ONLY: this file does not touch the isis_adjacency table, does
// not call enqueueBatch, and sends no SMS/push/in-app alerts. It's meant
// to run side-by-side with the production isisAdjacent.js (which owns all
// of that) while this NETCONF path is being evaluated — writing to the
// same rows / alert-cooldown columns from two independent crons would
// double-fire real alerts. Not wired into server.js / cron-runner.js /
// any route; require and call checkAdjacencyNetconf() manually to test.
//
// Once this is trusted enough to go live, replace the block marked
// "DRY RUN" below with the DB upsert + failure/recovery alerting +
// enqueueBatch(...) call from isisAdjacent.js's checkAdjacency (steps
// 1, 5-9 there) — the merged-record shape built here already matches
// what that file sends downstream.

const cron = require("node-cron");
const { Client: NetconfClient } = require("node-netconf");
const db = require("../Models");
const { Op } = require("sequelize");
const pLimit = require("p-limit").default;
const { withLock } = require("../utils/cronLock");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io, options = {}) => {
  // No NETCONF-specific credentials exist in this project yet — same
  // account used for SSH today is assumed to also have NETCONF access.
  // Override with NETCONF_USERNAME/NETCONF_PASSWORD if that ever differs.
  const netconfConfig = {
    port: parseInt(process.env.NETCONF_PORT || "830", 10),
    username: process.env.NETCONF_USERNAME || process.env.SSH_USERNAME,
    password: process.env.NETCONF_PASSWORD || process.env.SSH_PASSWORD,
  };

  // --- Persistent per-device NETCONF session cache -------------------------
  // ip -> { client, status, failCount, backoffUntil, connectPromise }
  // A session is opened once and reused across every poll cycle. It's only
  // ever closed and reopened on failure (bad RPC, closed socket, connect
  // error) — never torn down just because a cycle finished.
  const sessions = new Map();
  const BASE_BACKOFF_MS = 5000;
  const MAX_BACKOFF_MS = 5 * 60 * 1000;

  const scheduleBackoff = (entry) => {
    entry.failCount += 1;
    entry.backoffUntil =
      Date.now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (entry.failCount - 1));
  };

  const openSession = (ip) =>
    new Promise((resolve, reject) => {
      const client = new NetconfClient({ host: ip, ...netconfConfig });
      client.open((err) => (err ? reject(err) : resolve(client)));
    });

  // Returns an open, healthy session for this device — reusing the cached
  // one whenever possible. Returns null (instead of throwing) when the
  // device is inside its backoff window, so callers can skip it for this
  // cycle the same way isReachable()'s ping-skip works in isisAdjacent.js.
  const getSession = async (ip) => {
    let entry = sessions.get(ip);
    if (!entry) {
      entry = { client: null, status: "idle", failCount: 0, backoffUntil: 0, connectPromise: null };
      sessions.set(ip, entry);
    }

    if (entry.status === "connected" && entry.client && entry.client.connected) {
      return entry.client;
    }

    if (Date.now() < entry.backoffUntil) return null;

    // A connect already in flight for this device (e.g. a slow open still
    // pending from the previous tick) — piggyback on it instead of racing
    // a second connection to the same device.
    if (entry.connectPromise) return entry.connectPromise;

    entry.status = "connecting";
    entry.connectPromise = openSession(ip)
      .then((client) => {
        client.on("close", () => {
          entry.status = "idle";
          entry.client = null;
        });
        client.on("error", () => {
          entry.status = "idle";
          entry.client = null;
        });
        entry.client = client;
        entry.status = "connected";
        entry.failCount = 0;
        entry.connectPromise = null;
        return client;
      })
      .catch((err) => {
        entry.status = "idle";
        entry.client = null;
        entry.connectPromise = null;
        scheduleBackoff(entry);
        throw err;
      });

    return entry.connectPromise;
  };

  const invalidateSession = (ip) => {
    const entry = sessions.get(ip);
    if (!entry) return;
    if (entry.client) {
      try {
        entry.client.close();
      } catch (_) {
        // already gone
      }
    }
    entry.client = null;
    entry.status = "idle";
    scheduleBackoff(entry);
  };

  const rpc = (client, request) =>
    new Promise((resolve, reject) => {
      client.rpc(request, (err, reply) => (err ? reject(err) : resolve(reply)));
    });

  const closeAllSessions = () => {
    for (const entry of sessions.values()) {
      if (entry.client && entry.client.connected) {
        try {
          entry.client.close();
        } catch (_) {
          // already gone
        }
      }
    }
  };
  // Nothing else in this codebase holds connections open between cron
  // ticks, so nothing else needs this — but a persistent session here does,
  // otherwise a PM2 restart/reload leaves orphaned NETCONF sessions on
  // every device until the device's own idle timeout reaps them.
  process.on("SIGTERM", closeAllSessions);
  process.on("SIGINT", closeAllSessions);

  // --- ISIS adjacency parsing ----------------------------------------------
  const toArray = (val) => (val == null ? [] : Array.isArray(val) ? val : [val]);

  const parseIsisAdjacencyReply = (reply) => {
    const info = reply?.rpc_reply?.isis_adjacency_information;
    const rows = toArray(info?.isis_adjacency);
    // get-isis-adjacency-information (like "show isis adjacency") only
    // lists adjacencies that are currently established — there is no row
    // for a down neighbor to parse. Same assumption isisAdjacent.js's
    // regex relies on: everything returned here is Up, and a failure is
    // detected by a previously-Up key going missing from this list.
    return rows.map((adj) => {
      const rawInterface = String(adj.interface_name);
      return {
        raw_interface: rawInterface,
        interface: rawInterface.replace(/\.\d+$/, ""),
        neighbor_name: String(adj.system_name),
        level: Number(adj.level),
      };
    });
  };

  const fetchAdjacencies = async (device) => {
    const client = await getSession(device.ip);
    if (client === null) return null; // backing off — skip this cycle
    try {
      const reply = await rpc(client, "get-isis-adjacency-information");
      return parseIsisAdjacencyReply(reply);
    } catch (err) {
      // An RPC failure on a session we thought was healthy usually means
      // the session itself has gone bad (device-side idle timeout, NETCONF
      // agent restart, etc) — invalidate it so next cycle reconnects
      // instead of repeatedly failing the same stale handle.
      invalidateSession(device.ip);
      throw err;
    }
  };

  const checkAdjacencyNetconf = async () => {
    await withLock("isis_adjacent_netconf_cron", async () => {
      const devices = await Devices.findAll({
        where: { ip: { [Op.notIn]: ["41.175.37.22", "41.175.37.23"] } },
      });

      const runAdjacencyMap = new Map();

      const processDevice = async (device) => {
        try {
          // Read-only comparison against the live table so failure/recovery
          // detection mirrors isisAdjacent.js — this cron never writes here.
          const previousRecords = await IsisAdjacency.findAll({
            where: { local_device_id: device.id },
            raw: true,
          });
          const prevMap = new Map();
          previousRecords.forEach((rec) => {
            prevMap.set(`${rec.interface}|${rec.neighbor_name}|${rec.level}`, rec);
          });

          const adjacencies = await fetchAdjacencies(device);
          if (adjacencies === null) {
            console.warn(
              `[ISIS-NETCONF] ${device.name || device.ip} (${device.ip}) skipped — session backing off after a recent failure`,
            );
            return;
          }

          const currentUpKeys = new Set(
            adjacencies.map((a) => `${a.interface}|${a.neighbor_name}|${a.level}`),
          );

          const failures = [...prevMap.values()].filter(
            (rec) => rec.state === "Up" && !currentUpKeys.has(`${rec.interface}|${rec.neighbor_name}|${rec.level}`),
          );
          const recoveries = [...prevMap.values()].filter(
            (rec) => rec.state === "Down" && currentUpKeys.has(`${rec.interface}|${rec.neighbor_name}|${rec.level}`),
          );

          for (const adj of adjacencies) {
            const previousAdj = prevMap.get(`${adj.interface}|${adj.neighbor_name}|${adj.level}`);
            const recordKey = `${device.id}:${adj.neighbor_name}:${adj.raw_interface}`;
            runAdjacencyMap.set(recordKey, {
              local_device_id: device.id,
              neighbor_name: adj.neighbor_name,
              interface: adj.interface,
              raw_interface: adj.raw_interface,
              point_to_point_ip: previousAdj?.point_to_point_ip || null,
              level: adj.level,
              state: "Up",
            });
          }

          for (const failure of failures) {
            const recordKey = `${failure.local_device_id}:${failure.neighbor_name}:${failure.raw_interface}`;
            runAdjacencyMap.set(recordKey, {
              local_device_id: failure.local_device_id,
              neighbor_name: failure.neighbor_name,
              interface: failure.interface,
              raw_interface: failure.raw_interface,
              point_to_point_ip: failure.point_to_point_ip || null,
              level: failure.level,
              state: "Down",
            });
          }

          if (failures.length || recoveries.length) {
            console.log(
              `[ISIS-NETCONF][DRY RUN] ${device.name || device.ip}: ${failures.length} failure(s), ${recoveries.length} recovery event(s) detected — no DB write / alert sent (dry-run mode)`,
            );
          }
          console.log(`[ISIS-NETCONF] ✓ ${device.name || device.ip} polled (${adjacencies.length} adjacencies)`);
        } catch (err) {
          console.error(`[ISIS-NETCONF] ✗ ${device.ip}: ${err.message}`);
        }
      };

      const limit = pLimit(10);
      await Promise.all(devices.map((device) => limit(() => processDevice(device))));

      // --- DRY RUN ---------------------------------------------------------
      // Same merged-record shape isisAdjacent.js hands to
      // enqueueBatch("ISIS", ...) — deliberately not called here, see the
      // file header. metric/port_speed/input_bps/output_bps and the optics
      // fields stay null: those are polled by isisInterfaceMetric.js /
      // isisInterfaceStats.js and carried forward from the DB in the
      // production cron, which this dry run doesn't do since it never writes.
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
          metric: null,
          port_speed: null,
          input_bps: null,
          output_bps: null,
          level: a.level,
          state: a.state,
          tx_power_dbm: null,
          rx_power_dbm: null,
          tx_high_alarm_dbm: null,
          tx_low_alarm_dbm: null,
          tx_high_warning_dbm: null,
          tx_low_warning_dbm: null,
          rx_high_alarm_dbm: null,
          rx_low_alarm_dbm: null,
          rx_high_warning_dbm: null,
          rx_low_warning_dbm: null,
          last_power_checked: null,
        },
      }));

      console.log(
        `[ISIS-NETCONF][DRY RUN] Cycle complete: ${mergedRecords.length} adjacency record(s) built (not written to DB, not enqueued).`,
      );
      return mergedRecords;
    });
  };

  // Defaults OFF, unlike isisAdjacent.js's schedule-on-by-default — this is
  // a dry run meant to be invoked manually while you're evaluating it. Pass
  // { schedule: true } once you're ready to let it tick on its own.
  if (options.schedule === true) {
    checkAdjacencyNetconf().catch(console.error);
    cron.schedule("*/2 * * * *", () => {
      checkAdjacencyNetconf().catch(console.error);
    });
  }

  return { checkAdjacencyNetconf };
};

if (require.main === module) {
  module.exports(null)
    .checkAdjacencyNetconf()
    .then(() => {
      console.log("Done.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
