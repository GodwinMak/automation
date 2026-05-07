const db = require("../Models");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

// ──────────────────────────────────────────────────────────────────────────────
//  GET TOPOLOGY  (used by topology map view)
// ──────────────────────────────────────────────────────────────────────────────
exports.getTopology = async (req, res) => {
  try {
    const devices = await Devices.findAll();

    const nodes = devices.map((d) => ({
      id:   d.name,
      ip:   d.ip,
      lat:  d.lat,
      long: d.long,
    }));

    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const adjacencies = await IsisAdjacency.findAll();

    const links = adjacencies.map((a) => ({
      source:     deviceMap.get(a.local_device_id) || a.local_device_id,
      target:     a.neighbor_name,
      interface:  a.interface,
      raw_interface: a.raw_interface,
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
    const devices = await Devices.findAll();
    const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

    const nodeIPs = {};
    devices.forEach((d) => { nodeIPs[d.name] = d.ip || null; });

    const adjacencies = await IsisAdjacency.findAll();

    const linkMap = new Map();
    const downLinks = [];

    for (const a of adjacencies) {
      const source = deviceMap.get(a.local_device_id) || a.local_device_id;
      const target = a.neighbor_name;
      const level  = a.level || 1;
      const iface  = a.interface || null;
      const port_speed = a.port_speed || null; 
      const input_bps = a.input_bps || null;
      const output_bps = a.output_bps || null;

      const nodeA  = source < target ? source : target;
      const nodeB  = source < target ? target : source;
      const dir    = source < target ? "A" : "B";
      const pairKey = `${nodeA}|${nodeB}`;

      // 1. Keep track of specific Down links for the separate "Failures" UI list
      if (a.state === "Down") {
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
        // REMOVED: continue;  <-- We no longer skip the mapping below
      }

      // 2. Add to linkMap regardless of state so it appears in allEdges
      if (!linkMap.has(pairKey)) linkMap.set(pairKey, { A: [], B: [] });
      linkMap.get(pairKey)[dir].push({
        iface,
        level,
        state:      a.state, // Added state to the map
        metric:     a.metric     ?? null,
        port_speed: a.port_speed ?? null,
        input_bps:  a.input_bps  ?? null,
        output_bps: a.output_bps ?? null,
      });
    }

    const allEdges = [];

    for (const [pairKey, sides] of linkMap.entries()) {
      const [nodeA, nodeB] = pairKey.split("|");
      const aList = sides.A;
      const bList = sides.B;

      const pairs = Math.max(aList.length, bList.length);
      for (let i = 0; i < pairs; i++) {
        const a = aList[i] || {}; // Fallback if one side is missing
        const b = bList[i] || {};

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
      }
    }

    return res.json({ allEdges, downLinks, nodeIPs });
  } catch (error) {
    console.error("Impact data error:", error);
    return res.status(500).json({ message: "Failed to load impact data" });
  }
};