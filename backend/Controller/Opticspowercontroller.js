const db = require("../Models");
const { Op } = require("sequelize");

const Devices = db.devices;
const IsisAdjacency = db.isisAdjacency;

// Columns the optics power dashboard reads per interface.
const POWER_ATTRIBUTES = [
  "raw_interface",
  "neighbor_name",
  "port_speed",
  "state",
  "tx_power_dbm",
  "rx_power_dbm",
  "tx_high_alarm_dbm",
  "tx_low_alarm_dbm",
  "tx_high_warning_dbm",
  "tx_low_warning_dbm",
  "rx_high_alarm_dbm",
  "rx_low_alarm_dbm",
  "rx_high_warning_dbm",
  "rx_low_warning_dbm",
  "last_power_checked",
];

// Reshapes flat (IsisAdjacency + joined Device) rows into the
// [{ device_id, device_name, device_ip, interfaces: [...] }] array
// the optics power dashboard expects.
const groupByDevice = (rows) => {
  const byDevice = new Map();

  for (const row of rows) {
    const device = row.device;
    if (!device) continue;

    if (!byDevice.has(device.id)) {
      byDevice.set(device.id, {
        device_id: device.id,
        device_name: device.name,
        device_ip: device.ip,
        interfaces: [],
      });
    }

    byDevice.get(device.id).interfaces.push({
      raw_interface: row.raw_interface,
      neighbor_name: row.neighbor_name,
      port_speed: row.port_speed,
      state: row.state,
      tx_power_dbm: row.tx_power_dbm,
      rx_power_dbm: row.rx_power_dbm,
      tx_high_alarm_dbm: row.tx_high_alarm_dbm,
      tx_low_alarm_dbm: row.tx_low_alarm_dbm,
      tx_high_warning_dbm: row.tx_high_warning_dbm,
      tx_low_warning_dbm: row.tx_low_warning_dbm,
      rx_high_alarm_dbm: row.rx_high_alarm_dbm,
      rx_low_alarm_dbm: row.rx_low_alarm_dbm,
      rx_high_warning_dbm: row.rx_high_warning_dbm,
      rx_low_warning_dbm: row.rx_low_warning_dbm,
      last_power_checked: row.last_power_checked,
    });
  }

  return Array.from(byDevice.values());
};

// GET /api/optics/power
// Optional query params:
//   ?state=Up      only include adjacencies in this state (Up/Down)
//   ?search=RAH    filter by device name (LIKE %search%)
exports.getOpticsPower = async (req, res) => {
  const { state, search } = req.query;

  try {
    const where = {};
    if (state) where.state = state;

    const deviceWhere = search ? { name: { [Op.like]: `%${search}%` } } : undefined;

    const rows = await IsisAdjacency.findAll({
      attributes: ["local_device_id", ...POWER_ATTRIBUTES],
      where,
      include: [
        {
          model: Devices,
          attributes: ["id", "name", "ip"],
          required: true,
          as: "device",
          where: deviceWhere,
        },
      ],
      order: [
        [{ model: Devices, as: "device" }, "name", "ASC"],
        ["raw_interface", "ASC"],
      ],
      raw: true,
      nest: true,
    });

    const devices = groupByDevice(rows);

    res.status(200).json(devices);
  } catch (error) {
    console.error("Error fetching optics power data:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// GET /api/optics/power/device/:deviceId
// Single-device drilldown, e.g. for a device detail page.
exports.getOpticsPowerByDevice = async (req, res) => {
  const { deviceId } = req.params;

  try {
    const device = await Devices.findByPk(deviceId, {
      attributes: ["id", "name", "ip"],
    });

    if (!device) {
      return res.status(404).json({ message: "Device not found" });
    }

    const rows = await IsisAdjacency.findAll({
      attributes: POWER_ATTRIBUTES,
      where: { local_device_id: deviceId },
      order: [["raw_interface", "ASC"]],
      raw: true,
    });

    res.status(200).json({
      device_id: device.id,
      device_name: device.name,
      device_ip: device.ip,
      interfaces: rows,
    });
  } catch (error) {
    console.error("Error fetching optics power for device:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};