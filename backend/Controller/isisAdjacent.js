const db = require("../Models");
const { Op } = require("sequelize");
const axios = require("axios");
const { STALE_THRESHOLD_MS } = require("../utils/fiberCutDetector");
const { ptpNetworkKey } = require("../utils/ptpNetworkKey");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

const toProbeTargetIp = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // DB can store CIDR forms (e.g. 41.175.46.95/31); blackbox ICMP target
  // must be a host/IP literal, not a CIDR range.
  return raw.includes("/") ? raw.split("/")[0].trim() : raw;
};

const isFresh = (lastChecked) =>
  !lastChecked || Date.now() - new Date(lastChecked).getTime() < STALE_THRESHOLD_MS;

// ──────────────────────────────────────────────────────────────────────────────
//  GET ADJACENCY LIST  (used by the Settings "watch ISIS nodes" picker)
//
//  Every physical link is backed by TWO isis_adjacency rows — one from each
//  device's own perspective (e.g. "LTZ-PE1-RAH x LTZ-P1-SEA (et-9/1/2)" and
//  "LTZ-P1-SEA x LTZ-PE1-RAH (et-0/1/7)") — that would otherwise show up as
//  two separate, seemingly-unrelated picker entries. Grouped here by
//  ptpNetworkKey (the /31's network address, shared by both sides' host
//  IPs) so a user watching "the SEA side" is really watching the one
//  physical link and gets alerted no matter which side's row the cron
//  happens to be reporting the down/recovery event from.
//
//  Only links with a point_to_point_ip are returned — that network key is
//  what the watch list matches alerts against (see
//  utils/notificationRecipients.js), so a link without one can never
//  actually be watched.
// ──────────────────────────────────────────────────────────────────────────────
exports.getAdjacencyList = async (req, res) => {
  try {
    const devices = await Devices.findAll({ attributes: ["id", "name"], raw: true });
    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const adjacencies = await IsisAdjacency.findAll({
      attributes: ["id", "local_device_id", "neighbor_name", "interface", "point_to_point_ip", "state"],
      where: { point_to_point_ip: { [Op.ne]: null } },
      raw: true,
    });

    const groups = new Map(); // networkKey -> { networkKey, sides: [...] }
    for (const a of adjacencies) {
      const networkKey = ptpNetworkKey(a.point_to_point_ip);
      if (!networkKey) continue; // malformed IP — can't be reliably grouped or matched later
      if (!groups.has(networkKey)) groups.set(networkKey, { networkKey, sides: [] });
      groups.get(networkKey).sides.push({
        id: a.id,
        deviceName: deviceMap.get(a.local_device_id) || a.local_device_id,
        neighborName: a.neighbor_name,
        interface: a.interface,
        pointToPointIp: a.point_to_point_ip,
        state: a.state,
      });
    }

    const rows = Array.from(groups.values()).map((g) => ({
      // The network key is the canonical identity to watch by — both this
      // link's sides (if both have been polled/backfilled) resolve alerts
      // against it, see getIsisAlertRecipients.
      pointToPointIp: g.networkKey,
      label: g.sides
        .map((s) => `${s.deviceName} x ${s.neighborName} (${s.interface})`)
        .join("  <->  "),
      state: g.sides.some((s) => s.state === "Down") ? "Down" : "Up",
      sides: g.sides,
    }));

    return res.json({ adjacencies: rows });
  } catch (error) {
    console.error("Adjacency list error:", error);
    return res.status(500).json({ message: "Failed to load adjacency list" });
  }
};

// Prometheus HTTP service discovery endpoint for Blackbox ICMP targets.
// Returns unique point_to_point_ip values from isis_adjacency as:
// [{ targets: ["10.0.0.1", "10.0.0.2"], labels: { source: "isis_adjacency" } }]
exports.getBlackboxTargets = async (req, res) => {
  try {
    // Optional protection for internal target inventory.
    const expectedToken = process.env.MONITORING_SD_TOKEN;
    if (expectedToken) {
      const provided = req.query.token || req.header("x-monitoring-token");
      if (!provided || provided !== expectedToken) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const rows = await IsisAdjacency.findAll({
      attributes: ["point_to_point_ip"],
      where: { point_to_point_ip: { [Op.ne]: null } },
      raw: true,
    });

    const targets = [...new Set(
      rows
        .map((r) => toProbeTargetIp(r.point_to_point_ip))
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));

    return res.json([
      {
        targets,
        labels: {
          source: "isis_adjacency",
        },
      },
    ]);
  } catch (error) {
    console.error("Blackbox target discovery error:", error);
    return res.status(500).json({ message: "Failed to build blackbox targets" });
  }
};

// Prometheus scrape endpoint: one `ptp_link_info` series per point_to_point_ip
// carrying the owning device and its ISIS neighbor as labels. The ping prober
// (smokeping_prober) can't label its own targets, so Prometheus joins this to
// the ping results on `host`:
//   <loss expr> * on(host) group_left(device, neighbor, interface) ptp_link_info
// point_to_point_ip is the LOCAL device's own interface IP (local_device_id),
// neighbor_name is the device on the other end.
const promLabel = (v) =>
  String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");

exports.getPtpInfoMetrics = async (req, res) => {
  try {
    const expectedToken = process.env.MONITORING_SD_TOKEN;
    if (expectedToken) {
      const provided = req.query.token || req.header("x-monitoring-token");
      if (!provided || provided !== expectedToken) {
        return res.status(403).send("Forbidden");
      }
    }

    const devices = await Devices.findAll({ attributes: ["id", "name"], raw: true });
    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const rows = await IsisAdjacency.findAll({
      attributes: ["local_device_id", "neighbor_name", "interface", "point_to_point_ip"],
      where: { point_to_point_ip: { [Op.ne]: null } },
      raw: true,
    });

    // One series per IP — Prometheus rejects duplicate label sets.
    const seen = new Set();
    const lines = [
      "# HELP ptp_link_info Device and ISIS neighbor owning each point-to-point IP.",
      "# TYPE ptp_link_info gauge",
    ];
    for (const r of rows) {
      const host = toProbeTargetIp(r.point_to_point_ip);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      const device = deviceMap.get(r.local_device_id) || r.local_device_id;
      const linkId = ptpNetworkKey(r.point_to_point_ip) || "";
      lines.push(
        `ptp_link_info{host="${promLabel(host)}",device="${promLabel(device)}",neighbor="${promLabel(r.neighbor_name)}",interface="${promLabel(r.interface)}",link_id="${promLabel(linkId)}"} 1`,
      );
    }

    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.send(lines.join("\n") + "\n");
  } catch (error) {
    console.error("PTP info metrics error:", error);
    return res.status(500).send("error");
  }
};

// ──────────────────────────────────────────────────────────────────────────────
//  GET PING MONITOR  (used by the Ping Monitor page)
//
//  Reads packet loss / latency for every point_to_point_ip from the
//  Prometheus instance that scrapes smokeping_prober (see /opt/ping-monitor)
//  and attaches the owning device + ISIS neighbor from isis_adjacency.
//  point_to_point_ip is the LOCAL device's own interface IP (local_device_id);
//  neighbor_name is the device on the other end.
// ──────────────────────────────────────────────────────────────────────────────
const PROMETHEUS_URL = (process.env.PROMETHEUS_URL || "http://127.0.0.1:9090").replace(/\/$/, "");
const LOSS_WARN_THRESHOLD = 0.05;
const PING_WINDOW = "5m";

const promInstantQuery = async (query) => {
  const { data } = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
    params: { query },
    timeout: 10000,
  });
  if (data.status !== "success") throw new Error(`Prometheus query failed: ${query}`);
  const byHost = new Map();
  for (const r of data.data.result) {
    const v = parseFloat(r.value[1]);
    byHost.set(r.metric.host, Number.isNaN(v) ? null : v);
  }
  return byHost;
};

exports.getPingMonitor = async (req, res) => {
  try {
    const [loss, rtt] = await Promise.all([
      promInstantQuery(
        `1 - (rate(smokeping_response_duration_seconds_count[${PING_WINDOW}]) / rate(smokeping_requests_total[${PING_WINDOW}]))`,
      ),
      promInstantQuery(
        `rate(smokeping_response_duration_seconds_sum[${PING_WINDOW}]) / rate(smokeping_response_duration_seconds_count[${PING_WINDOW}])`,
      ),
    ]);

    const devices = await Devices.findAll({ attributes: ["id", "name"], raw: true });
    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const adjacencies = await IsisAdjacency.findAll({
      attributes: ["local_device_id", "neighbor_name", "interface", "point_to_point_ip", "state", "level"],
      // Ping Monitor only lists links above ISIS level 1 (level 2 and up).
      where: { point_to_point_ip: { [Op.ne]: null }, level: { [Op.gt]: 1 } },
      raw: true,
    });

    const seen = new Set();
    const rows = [];
    for (const a of adjacencies) {
      const ip = toProbeTargetIp(a.point_to_point_ip);
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);

      const lossRatio = loss.has(ip) ? loss.get(ip) : null;
      const rttSeconds = rtt.has(ip) ? rtt.get(ip) : null;
      let status = "nodata";
      if (lossRatio !== null) {
        status = lossRatio >= 0.999 ? "unreachable" : lossRatio > LOSS_WARN_THRESHOLD ? "loss" : "ok";
      }

      rows.push({
        ip,
        device: deviceMap.get(a.local_device_id) || a.local_device_id,
        neighbor: a.neighbor_name,
        interface: a.interface,
        linkId: ptpNetworkKey(a.point_to_point_ip),
        isisState: a.state,
        level: a.level,
        lossPercent: lossRatio === null ? null : Math.max(0, Math.round(lossRatio * 10000) / 100),
        avgRttMs: rttSeconds === null ? null : Math.round(rttSeconds * 100000) / 100,
        status,
      });
    }

    rows.sort((x, y) => x.ip.localeCompare(y.ip, undefined, { numeric: true }));
    return res.json({ window: PING_WINDOW, lossWarnPercent: LOSS_WARN_THRESHOLD * 100, rows });
  } catch (error) {
    console.error("Ping monitor error:", error.message);
    return res.status(502).json({ message: "Failed to read ping results from Prometheus" });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
//  GET TOPOLOGY  (used by topology map view)
// ──────────────────────────────────────────────────────────────────────────────
exports.getTopology = async (req, res) => {
  try {
    const devices = await Devices.findAll({
      attributes: ["id", "name", "ip", "lat", "long"],
      raw: true,
    });

    const nodes = devices.map((d) => ({
      id:   d.name,
      ip:   d.ip,
      lat:  d.lat,
      long: d.long,
    }));

    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const adjacencies = await IsisAdjacency.findAll({
      attributes: [
        "local_device_id", "neighbor_name", "interface", "raw_interface",
        "point_to_point_ip", "level", "state", "metric", "port_speed",
        "last_seen", "last_checked",
      ],
      raw: true,
    });

    const links = adjacencies.map((a) => ({
      source:     deviceMap.get(a.local_device_id) || a.local_device_id,
      target:     a.neighbor_name,
      interface:  a.interface,
      raw_interface: a.raw_interface,
      point_to_point_ip: a.point_to_point_ip,
      level:      a.level,
      state:      a.state,
      metric:     a.metric,
      port_speed: a.port_speed,
      last_seen:  a.last_seen,
      last_checked: a.last_checked,
    }));

    return res.json({ nodes, links });
  } catch (error) {
    console.error("Topology error:", error);
    return res.status(500).json({ message: "Failed to load topology" });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
//  GET IMPACT DATA  (used by ISIS Impact Analyzer frontend)
//
//  Edge format returned:
//    [ nodeA, nodeB, level, "ifaceA<->ifaceB", metric, portSpeed ]
//
//  Where:
//    - nodeA / nodeB  : alphabetically sorted device names
//    - level          : ISIS level (1, 2, or 3)
//    - "ifaceA<->ifaceB" : combined interface string
//                         ifaceA = nodeA's physical interface
//                         ifaceB = nodeB's physical interface
//    - metric         : ISIS L1 metric on this link (from nodeA's perspective)
//                       null if unknown
//    - portSpeed      : port speed in Mbps (1000 / 10000 / 100000)
//                       null if unknown
//
//  Down links returned separately as:
//    { a, b, iface, since, duration }
// ──────────────────────────────────────────────────────────────────────────────
// exports.getImpactData = async (req, res) => {
//   try {
//     const devices = await Devices.findAll();
//     const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

//     // nodeIPs: used by the frontend to display IPs in result headers
//     const nodeIPs = {};
//     devices.forEach((d) => { nodeIPs[d.name] = d.ip || null; });

//     const adjacencies = await IsisAdjacency.findAll();

//     // ── Group by ordered (nodeA, nodeB) pair ────────────────────────────────
//     //
//     // For each ordered pair we collect:
//     //   dir='A' → adjacency rows where source < target  (source is nodeA)
//     //   dir='B' → adjacency rows where source > target  (source is nodeB)
//     //
//     // Each direction stores a list of interface entries so we can pair them
//     // up by index to produce per-link rows.
//     // ────────────────────────────────────────────────────────────────────────
//     const linkMap = new Map();
//     // key: "nodeA|nodeB"
//     // val: { A: [ {iface, level, metric, port_speed}, … ],
//     //        B: [ {iface, level, metric, port_speed}, … ] }

//     const downLinks = [];

//     for (const a of adjacencies) {
//       const source = deviceMap.get(a.local_device_id) || a.local_device_id;
//       const target = a.neighbor_name;
//       const level  = a.level || 1;
//       const iface  = a.interface || null;   // physical, e.g. ge-0/1/0
//       const port_speed = a.port_speed || null; 

//       const nodeA  = source < target ? source : target;
//       const nodeB  = source < target ? target : source;
//       const dir    = source < target ? "A" : "B";
//       const pairKey = `${nodeA}|${nodeB}`;

//       if (a.state === "Down") {
//         downLinks.push({
//           a: nodeA,
//           b: nodeB,
//           iface,
//           port_speed,
//           since: a.last_seen || null,
//           duration: a.last_seen
//             ? (() => {
//                 const mins = Math.round(
//                   (Date.now() - new Date(a.last_seen).getTime()) / 60000
//                 );
//                 return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
//               })()
//             : "unknown",
//         });
//         continue;
//       }

//       if (!linkMap.has(pairKey)) linkMap.set(pairKey, { A: [], B: [] });
//       linkMap.get(pairKey)[dir].push({
//         iface,
//         level,
//         metric:     a.metric     ?? null,  // ISIS L1 metric
//         port_speed: a.port_speed ?? null,  // Mbps
//       });
//     }

//     // ── Build allEdges array ─────────────────────────────────────────────────
//     const allEdges = [];

//     for (const [pairKey, sides] of linkMap.entries()) {
//       const [nodeA, nodeB] = pairKey.split("|");
//       const aList = sides.A;  // adjacencies from nodeA's side
//       const bList = sides.B;  // adjacencies from nodeB's side

//       if (aList.length === 0 && bList.length === 0) continue;

//       // If both sides reported, pair them by index (order matches DB insertion)
//       if (aList.length > 0 && bList.length > 0) {
//         const pairs = Math.max(aList.length, bList.length);
//         for (let i = 0; i < pairs; i++) {
//           const a = aList[i % aList.length];
//           const b = bList[i % bList.length];

//           const ifaceStr = `${a.iface || "?"}<->${b.iface || "?"}`;
//           const level    = a.level || b.level || 1;
//           // Prefer nodeA's metric; fall back to nodeB's
//           const metric     = a.metric     ?? b.metric     ?? null;
//           const port_speed = a.port_speed ?? b.port_speed ?? null;

//           allEdges.push([nodeA, nodeB, level, ifaceStr, metric, port_speed]);
//         }
//       } else if (aList.length > 0) {
//         // Only nodeA side reported (unidirectional / neighbour not monitored)
//         for (const entry of aList) {
//           allEdges.push([
//             nodeA, nodeB, entry.level,
//             `${entry.iface || "?"}`,
//             entry.metric, entry.port_speed,
//           ]);
//         }
//       } else {
//         // Only nodeB side reported
//         for (const entry of bList) {
//           allEdges.push([
//             nodeA, nodeB, entry.level,
//             `${entry.iface || "?"}`,
//             entry.metric, entry.port_speed,
//           ]);
//         }
//       }
//     }

//     return res.json({ allEdges, downLinks, nodeIPs });
//   } catch (error) {
//     console.error("Impact data error:", error);
//     return res.status(500).json({ message: "Failed to load impact data" });
//   }
// };

exports.getImpactData = async (req, res) => {
  try {
    const devices = await Devices.findAll({
      attributes: ["id", "name", "ip"],
      raw: true,
    });
    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const nodeIPs = {};
    devices.forEach((d) => { nodeIPs[d.name] = d.ip || null; });

    const adjacencies = await IsisAdjacency.findAll({
      attributes: [
        "local_device_id", "neighbor_name", "interface", "level", "state",
        "metric", "port_speed", "input_bps", "output_bps", "last_seen",
        "last_checked", "point_to_point_ip",
      ],
      raw: true,
    });

    const linkMap = new Map();
    const downLinks = [];
    // Both rows describing one physical link — one from each device's own
    // perspective — get pushed independently below; dedupe the fault list
    // by physical link identity so a single down link is reported once
    // instead of once per side. ptpNetworkKey is the reliable identity when
    // available; falls back to (pair, interface) when point_to_point_ip
    // hasn't been backfilled for that row yet.
    const seenDownLinkKeys = new Set();

    for (const a of adjacencies) {
      const source = deviceMap.get(a.local_device_id) || a.local_device_id;
      const target = a.neighbor_name;
      const level  = a.level || 1;
      const iface  = a.interface || null;
      const port_speed = a.port_speed || null;
      const input_bps = a.input_bps || null;
      const output_bps = a.output_bps || null;
      const ptpKey = ptpNetworkKey(a.point_to_point_ip);
      // A stale row can't be trusted as a confirmed Down — treat it as Up
      // rather than letting it show a node as falsely down/isolated in the UI.
      const effectiveState = a.state === "Down" && !isFresh(a.last_checked) ? "Up" : a.state;

      const nodeA  = source < target ? source : target;
      const nodeB  = source < target ? target : source;
      const dir    = source < target ? "A" : "B";
      const pairKey = `${nodeA}|${nodeB}`;

      // 1. Keep track of specific Down links for the separate "Failures" UI list
      if (effectiveState === "Down") {
        const dedupeKey = ptpKey ? `ptp:${ptpKey}` : `pair:${pairKey}:${iface}`;
        if (!seenDownLinkKeys.has(dedupeKey)) {
          seenDownLinkKeys.add(dedupeKey);
          downLinks.push({
            a: nodeA,
            b: nodeB,
            iface,
            port_speed,
            since: a.last_seen || null,
            duration: a.last_seen
              ? (() => {
                  const mins = Math.round((Date.now() - new Date(a.last_seen).getTime()) / 60000);
                  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
                })()
              : "unknown",
          });
        }
        // REMOVED: continue;  <-- We no longer skip the mapping below
      }

      // 2. Add to linkMap regardless of state so it appears in allEdges
      if (!linkMap.has(pairKey)) linkMap.set(pairKey, { A: [], B: [] });
      linkMap.get(pairKey)[dir].push({
        iface,
        level,
        state:      effectiveState, // Added state to the map
        metric:     a.metric     ?? null,
        port_speed: a.port_speed ?? null,
        input_bps:  a.input_bps  ?? null,
        output_bps: a.output_bps ?? null,
        ptpKey,
      });
    }

    const allEdges = [];

    for (const [pairKey, sides] of linkMap.entries()) {
      const [nodeA, nodeB] = pairKey.split("|");

      const emitEdge = (a, b) => {
        const ifaceStr = `${a.iface || "?"}<->${b.iface || "?"}`;
        const level    = a.level || b.level || 1;
        const metric     = a.metric     ?? b.metric     ?? null;
        const port_speed = a.port_speed ?? b.port_speed ?? null;
        const input_bps  = a.input_bps  ?? b.input_bps  ?? null;
        const output_bps = a.output_bps ?? b.output_bps ?? null;
        // A link is considered "Down" in allEdges if either side reports it as Down
        const combinedState = (a.state === "Down" || b.state === "Down") ? "Down" : "Up";
        // Pushing 7th element (state) so analyzer knows it's a failed path
        allEdges.push([nodeA, nodeB, level, ifaceStr, metric, port_speed, combinedState, input_bps, output_bps]);
      };

      // Rows carry each device's own local interface name, with no shared
      // identifier to tell which row on side A is the same physical link
      // as which row on side B — so pairing by raw array position used to
      // assume the Nth entry on each side was the same physical link,
      // which isn't guaranteed. When a device has multiple parallel links
      // to the same neighbor, an unlucky ordering could combine one
      // interface's Down state with a completely unrelated interface's Up
      // state, turning a real Up link into a phantom Down (and from there,
      // a falsely "isolated" node).
      const aRemaining = [...sides.A];
      const bRemaining = [...sides.B];

      // Pass 1: pair rows that share a backfilled point-to-point subnet
      // (see ptpNetworkKey) — a reliable signal that they're the same
      // physical link regardless of DB row ordering.
      for (let i = aRemaining.length - 1; i >= 0; i--) {
        const a = aRemaining[i];
        if (!a.ptpKey) continue;
        const j = bRemaining.findIndex((b) => b.ptpKey === a.ptpKey);
        if (j === -1) continue;
        emitEdge(a, bRemaining[j]);
        aRemaining.splice(i, 1);
        bRemaining.splice(j, 1);
      }

      // Pass 2: whatever's left (point_to_point_ip not backfilled yet on
      // either side) falls back to state-sorted positional pairing —
      // Down-before-Up on both sides makes the common case (one specific
      // interface down, reported consistently from both ends) pair up
      // correctly even without a reliable shared identifier.
      const byStateThenIface = (x, y) =>
        x.state === y.state ? 0 : x.state === "Down" ? -1 : 1;
      aRemaining.sort(byStateThenIface);
      bRemaining.sort(byStateThenIface);
      const pairs = Math.max(aRemaining.length, bRemaining.length);
      for (let i = 0; i < pairs; i++) {
        emitEdge(aRemaining[i] || {}, bRemaining[i] || {});
      }
    }

    return res.json({ allEdges, downLinks, nodeIPs });
  } catch (error) {
    console.error("Impact data error:", error);
    return res.status(500).json({ message: "Failed to load impact data" });
  }
};