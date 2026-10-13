const db = require("../Models");
const { getLiveTopologyData } = require("./weathermap");

const NetworkMap = db.networkMaps;
const NetworkMapNode = db.networkMapNodes;
const NetworkMapLink = db.networkMapLinks;
const Users = db.users;
const IsisAdjacency = db.isisAdjacency;
const Devices = db.devices;

// Columns needed to show real per-interface throughput and optics power/
// alarm state on link hover — same set Opticspowercontroller.js reads for
// the standalone Optics Power dashboard, kept in sync manually with that
// file's own copy (same pattern as other shared attribute-list pairs in
// this codebase, e.g. PE_VPLS_DEVICES in l2vpnCircuit.js/updateL2VPN.js).
const LINK_END_ATTRIBUTES = [
  "interface", "state", "port_speed", "input_bps", "output_bps",
  "tx_power_dbm", "rx_power_dbm",
  "tx_high_alarm_dbm", "tx_low_alarm_dbm", "tx_high_warning_dbm", "tx_low_warning_dbm",
  "rx_high_alarm_dbm", "rx_low_alarm_dbm", "rx_high_warning_dbm", "rx_low_warning_dbm",
  "last_power_checked",
];

// A saved link's sourceDeviceName/targetDeviceName are whichever node the
// admin clicked first/second while drawing it — unrelated to
// getLiveTopologyData's edge.source/target, which buildIsisEdges
// (Controller/weathermap.js) always assigns alphabetically. findLiveEdge
// below already matches a saved link to its live edge in EITHER direction,
// but blindly copying that live edge's inputBps/outputBps onto the saved
// link silently mislabels them whenever the admin's click order happened
// to be the reverse of alphabetical — the two devices' real counters get
// swapped on screen with no indication anything is wrong. Resolving each
// END's own isis_adjacency row directly, keyed to the saved link's own
// sourceDeviceName+sourceInterface / targetDeviceName+targetInterface,
// sidesteps that entirely: sourceEnd.outputBps is unambiguously "traffic
// leaving sourceDeviceName on this link" no matter which node was clicked
// first. Same lookup also carries each end's real optics tx/rx power and
// alarm/warning thresholds, for the hover tooltip.
const resolveLinkEnds = async (links) => {
  const wantedByDevice = new Map();
  for (const l of links) {
    if (l.sourceInterface) {
      if (!wantedByDevice.has(l.sourceDeviceName)) wantedByDevice.set(l.sourceDeviceName, new Set());
      wantedByDevice.get(l.sourceDeviceName).add(l.sourceInterface);
    }
    if (l.targetInterface) {
      if (!wantedByDevice.has(l.targetDeviceName)) wantedByDevice.set(l.targetDeviceName, new Set());
      wantedByDevice.get(l.targetDeviceName).add(l.targetInterface);
    }
  }
  const deviceNames = [...wantedByDevice.keys()];
  if (deviceNames.length === 0) return new Map();

  const rows = await IsisAdjacency.findAll({
    attributes: LINK_END_ATTRIBUTES,
    include: [
      { model: Devices, as: "device", attributes: ["name"], required: true, where: { name: deviceNames } },
    ],
    raw: true,
    nest: true,
  });

  const byKey = new Map();
  for (const r of rows) {
    byKey.set(`${r.device.name}::${r.interface}`, r);
  }
  return byKey;
};

const toLinkEnd = (adj) => {
  if (!adj) return null;
  return {
    state: adj.state,
    portSpeedMbps: adj.port_speed != null ? Number(adj.port_speed) : null,
    inputBps: adj.input_bps,
    outputBps: adj.output_bps,
    txPowerDbm: adj.tx_power_dbm,
    rxPowerDbm: adj.rx_power_dbm,
    txHighAlarmDbm: adj.tx_high_alarm_dbm,
    txLowAlarmDbm: adj.tx_low_alarm_dbm,
    txHighWarningDbm: adj.tx_high_warning_dbm,
    txLowWarningDbm: adj.tx_low_warning_dbm,
    rxHighAlarmDbm: adj.rx_high_alarm_dbm,
    rxLowAlarmDbm: adj.rx_low_alarm_dbm,
    rxHighWarningDbm: adj.rx_high_warning_dbm,
    rxLowWarningDbm: adj.rx_low_warning_dbm,
    lastPowerChecked: adj.last_power_checked,
  };
};

exports.getAllMaps = async (req, res) => {
  try {
    const maps = await NetworkMap.findAll({
      include: [
        { model: Users, as: "creator", attributes: ["id", "fullName", "username"] },
        { model: NetworkMapNode, as: "nodes", attributes: ["id"] },
        { model: NetworkMapLink, as: "links", attributes: ["id"] },
      ],
      order: [["updatedAt", "DESC"]],
    });

    const result = maps.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      updatedAt: m.updatedAt,
      createdByName: m.creator?.fullName || m.creator?.username || "Unknown",
      nodeCount: m.nodes?.length || 0,
      linkCount: m.links?.length || 0,
    }));

    return res.json({ maps: result });
  } catch (error) {
    console.error("Get network maps error:", error);
    return res.status(500).json({ message: "Failed to load network maps" });
  }
};

exports.getMapById = async (req, res) => {
  try {
    const map = await NetworkMap.findByPk(req.params.id, {
      include: [
        { model: Users, as: "creator", attributes: ["id", "fullName", "username"] },
        { model: NetworkMapNode, as: "nodes" },
        { model: NetworkMapLink, as: "links" },
      ],
    });
    if (!map) return res.status(404).json({ message: "Map not found" });

    const { links: liveLinks } = await getLiveTopologyData();

    // A saved link matches a live edge from either direction — the admin
    // drew A->B, but getLiveTopologyData's pairing may have emitted the
    // same physical link as B->A depending on device-name sort order.
    const findLiveEdge = (link) =>
      liveLinks.find(
        (e) =>
          ((e.source === link.sourceDeviceName && e.target === link.targetDeviceName) ||
            (e.source === link.targetDeviceName && e.target === link.sourceDeviceName)) &&
          (link.sourceInterface == null ||
            e.sourceInterface === link.sourceInterface ||
            e.targetInterface === link.sourceInterface)
      );

    const nodes = (map.nodes || []).map((n) => ({
      id: n.id,
      deviceName: n.deviceName,
      x: n.x,
      y: n.y,
    }));

    const endByKey = await resolveLinkEnds(map.links || []);

    const links = (map.links || []).map((l) => {
      const live = findLiveEdge(l);
      const sourceAdj = l.sourceInterface ? endByKey.get(`${l.sourceDeviceName}::${l.sourceInterface}`) : null;
      const targetAdj = l.targetInterface ? endByKey.get(`${l.targetDeviceName}::${l.targetInterface}`) : null;
      return {
        id: l.id,
        sourceDeviceName: l.sourceDeviceName,
        targetDeviceName: l.targetDeviceName,
        sourceInterface: l.sourceInterface,
        targetInterface: l.targetInterface,
        capacityMbps: l.capacityMbps,
        bendX: l.bendX,
        bendY: l.bendY,
        live: Boolean(live),
        state: live?.state ?? null,
        portSpeedMbps: live?.portSpeedMbps ?? null,
        // Resolved from sourceDeviceName's OWN isis_adjacency row (see
        // resolveLinkEnds above), not getLiveTopologyData's edge — falls
        // back to the live edge only when that lookup found nothing (e.g.
        // stale/never-polled interface), same as before.
        inputBps: sourceAdj?.input_bps ?? live?.inputBps ?? null,
        outputBps: sourceAdj?.output_bps ?? live?.outputBps ?? null,
        utilizationPercent: live?.utilizationPercent ?? null,
        sourceEnd: toLinkEnd(sourceAdj),
        targetEnd: toLinkEnd(targetAdj),
      };
    });

    return res.json({
      id: map.id,
      name: map.name,
      description: map.description,
      updatedAt: map.updatedAt,
      createdByName: map.creator?.fullName || map.creator?.username || "Unknown",
      nodes,
      links,
    });
  } catch (error) {
    console.error("Get network map error:", error);
    return res.status(500).json({ message: "Failed to load network map" });
  }
};

exports.createMap = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Map name is required" });
    }

    const map = await NetworkMap.create({
      name: name.trim(),
      description: description || null,
      createdBy: req.user.id,
    });

    return res.status(201).json({ id: map.id });
  } catch (error) {
    console.error("Create network map error:", error);
    return res.status(500).json({ message: "Failed to create network map" });
  }
};

exports.updateMap = async (req, res) => {
  try {
    const map = await NetworkMap.findByPk(req.params.id);
    if (!map) return res.status(404).json({ message: "Map not found" });

    const { name, description, nodes, links } = req.body;

    await db.sequelize.transaction(async (t) => {
      await map.update(
        {
          name: name != null ? String(name).trim() : map.name,
          description: description !== undefined ? description : map.description,
        },
        { transaction: t }
      );

      await NetworkMapNode.destroy({ where: { mapId: map.id }, transaction: t });
      await NetworkMapLink.destroy({ where: { mapId: map.id }, transaction: t });

      if (Array.isArray(nodes) && nodes.length > 0) {
        await NetworkMapNode.bulkCreate(
          nodes.map((n) => ({
            mapId: map.id,
            deviceName: n.deviceName,
            x: n.x,
            y: n.y,
          })),
          { transaction: t }
        );
      }

      if (Array.isArray(links) && links.length > 0) {
        await NetworkMapLink.bulkCreate(
          links.map((l) => ({
            mapId: map.id,
            sourceDeviceName: l.sourceDeviceName,
            targetDeviceName: l.targetDeviceName,
            sourceInterface: l.sourceInterface || null,
            targetInterface: l.targetInterface || null,
            capacityMbps: l.capacityMbps || null,
            bendX: l.bendX ?? null,
            bendY: l.bendY ?? null,
          })),
          { transaction: t }
        );
      }
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Update network map error:", error);
    return res.status(500).json({ message: "Failed to update network map" });
  }
};

exports.deleteMap = async (req, res) => {
  try {
    const map = await NetworkMap.findByPk(req.params.id);
    if (!map) return res.status(404).json({ message: "Map not found" });

    await map.destroy();
    return res.json({ success: true });
  } catch (error) {
    console.error("Delete network map error:", error);
    return res.status(500).json({ message: "Failed to delete network map" });
  }
};
