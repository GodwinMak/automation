const db = require("../Models");
const { getDeviceTier } = require("../utils/deviceTier");
const { computeUtilization } = require("../utils/junosInterfaceStats");
const { ptpNetworkKey } = require("../utils/ptpNetworkKey");
const { STALE_THRESHOLD_MS } = require("../utils/fiberCutDetector");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

const isFresh = (lastChecked) =>
  !lastChecked || Date.now() - new Date(lastChecked).getTime() < STALE_THRESHOLD_MS;

// Pairs up isis_adjacency's two one-sided rows per physical link into one
// edge. Deliberately a fresh, self-contained copy of the pairing algorithm
// in Controller/isisAdjacent.js's getImpactData rather than a shared/
// refactored import — that function is load-bearing for the working ISIS
// Impact Analyzer feature and this endpoint has no need to touch it.
//
// ISIS runs across the full backbone AND access mesh in this network
// (confirmed against production data — ACC<->ACC and ACC<->AGG links carry
// point_to_point_ip the same as PE/P links), so this single source covers
// every tier the weathermap needs. No separate access-tier discovery.
const buildIsisEdges = (devices) => {
  const deviceMap = new Map(devices.map((d) => [d.id, d.name]));

  return IsisAdjacency.findAll({
    attributes: [
      "local_device_id", "neighbor_name", "interface", "level", "state",
      "port_speed", "input_bps", "output_bps", "last_checked", "point_to_point_ip",
    ],
    raw: true,
  }).then((adjacencies) => {
    const linkMap = new Map();

    for (const a of adjacencies) {
      const source = deviceMap.get(a.local_device_id) || a.local_device_id;
      const target = a.neighbor_name;
      const ptpKey = ptpNetworkKey(a.point_to_point_ip);
      const effectiveState = a.state === "Down" && !isFresh(a.last_checked) ? "Up" : a.state;

      const nodeA = source < target ? source : target;
      const nodeB = source < target ? target : source;
      const dir = source < target ? "A" : "B";
      const pairKey = `${nodeA}|${nodeB}`;

      if (!linkMap.has(pairKey)) linkMap.set(pairKey, { A: [], B: [] });
      linkMap.get(pairKey)[dir].push({
        iface: a.interface || null,
        level: a.level || 1,
        state: effectiveState,
        port_speed: a.port_speed ?? null,
        input_bps: a.input_bps ?? null,
        output_bps: a.output_bps ?? null,
        ptpKey,
      });
    }

    const edges = [];

    for (const [pairKey, sides] of linkMap.entries()) {
      const [nodeA, nodeB] = pairKey.split("|");

      const emitEdge = (a, b) => {
        const port_speed = a.port_speed ?? b.port_speed ?? null;
        const input_bps = a.input_bps ?? b.input_bps ?? null;
        const output_bps = a.output_bps ?? b.output_bps ?? null;
        const combinedState = (a.state === "Down" || b.state === "Down") ? "Down" : "Up";
        edges.push({
          source: nodeA,
          target: nodeB,
          sourceInterface: a.iface || null,
          targetInterface: b.iface || null,
          level: a.level || b.level || 1,
          state: combinedState,
          portSpeedMbps: port_speed,
          inputBps: input_bps,
          outputBps: output_bps,
        });
      };

      const aRemaining = [...sides.A];
      const bRemaining = [...sides.B];

      for (let i = aRemaining.length - 1; i >= 0; i--) {
        const a = aRemaining[i];
        if (!a.ptpKey) continue;
        const j = bRemaining.findIndex((b) => b.ptpKey === a.ptpKey);
        if (j === -1) continue;
        emitEdge(a, bRemaining[j]);
        aRemaining.splice(i, 1);
        bRemaining.splice(j, 1);
      }

      const byStateThenIface = (x, y) =>
        x.state === y.state ? 0 : x.state === "Down" ? -1 : 1;
      aRemaining.sort(byStateThenIface);
      bRemaining.sort(byStateThenIface);
      const pairs = Math.max(aRemaining.length, bRemaining.length);
      for (let i = 0; i < pairs; i++) {
        emitEdge(aRemaining[i] || {}, bRemaining[i] || {});
      }
    }

    return edges;
  });
};

// Plain data function (no req/res) so other controllers — e.g.
// Controller/networkMap.js resolving a saved map's links against live
// state — can call this server-side without an internal HTTP round-trip.
// The route handler below is just a thin wrapper over it.
const getLiveTopologyData = async () => {
  const devices = await Devices.findAll({
    attributes: ["id", "name", "ip"],
    raw: true,
  });

  const nodes = devices.map((d) => ({
    id: d.name,
    tier: getDeviceTier(d.name),
  }));

  const edges = await buildIsisEdges(devices);

  // International peers (LKE-/LZA-/LZH-/LDJ-/LZM- prefixed) are reported
  // as the far end of a peering adjacency by our own edge P routers, but
  // this app only has SSH credentials for its own LTZ fleet — they were
  // never independently added to the `devices` table, so they'd otherwise
  // have no node to render at all even though real edges reference them.
  // Synthesize a node for any edge endpoint that isn't a known device.
  const knownDeviceNames = new Set(devices.map((d) => d.name));
  const seenSyntheticNames = new Set();
  for (const edge of edges) {
    for (const name of [edge.source, edge.target]) {
      if (knownDeviceNames.has(name) || seenSyntheticNames.has(name)) continue;
      seenSyntheticNames.add(name);
      nodes.push({ id: name, tier: getDeviceTier(name) });
    }
  }

  const links = edges.map((edge) => ({
    ...edge,
    utilizationPercent:
      edge.state === "Up" && edge.portSpeedMbps && edge.inputBps != null && edge.outputBps != null
        ? computeUtilization(edge.inputBps, edge.outputBps, edge.portSpeedMbps)
        : null,
  }));

  return { nodes, links };
};

exports.getLiveTopologyData = getLiveTopologyData;

exports.getWeathermapTopology = async (req, res) => {
  try {
    const data = await getLiveTopologyData();
    return res.json(data);
  } catch (error) {
    console.error("Weathermap topology error:", error);
    return res.status(500).json({ message: "Failed to load weathermap topology" });
  }
};
