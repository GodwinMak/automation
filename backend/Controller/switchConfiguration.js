const fs = require("fs");
const path = require("path");
const db = require("../Models");

const SwitchConfiguration = db.switchConfiguration;
const Device = db.devices;
const { Op } = db.Sequelize;

const baseDir = path.join(__dirname, "..", "SwitchConfigs");

const sanitizeFilenamePart = (value) => {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
};

exports.listSwitchConfigurations = async (req, res) => {
  const page = Number.parseInt(req.query.page, 10) || 1;
  const pageSize = Number.parseInt(req.query.pageSize, 10) || 10;
  const offset = (page - 1) * pageSize;
  const search = String(req.query.search || "").trim();

  const where = search
    ? {
        [Op.or]: [
          { deviceName: { [Op.like]: `%${search}%` } },
          { "$device.ip$": { [Op.like]: `%${search}%` } },
          { "$device.name$": { [Op.like]: `%${search}%` } },
        ],
      }
    : undefined;

  try {
    const { count, rows } = await SwitchConfiguration.findAndCountAll({
      where,
      include: [
        {
          model: Device,
          attributes: ["ip", "name"],
          required: false,
        },
      ],
      order: [["updatedAt", "DESC"]],
      limit: pageSize,
      offset,
      distinct: true,
      subQuery: false,
    });

    const items = rows.map((row) => ({
      id: row.id,
      deviceId: row.deviceId,
      deviceName: row.deviceName || row.device?.name || "",
      ip: row.device?.ip || "",
      filePath: row.filePath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    res.status(200).json({
      items,
      totalItems: count,
      totalPages: Math.ceil(count / pageSize),
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching switch configurations:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.downloadSwitchConfiguration = async (req, res) => {
  const { id } = req.params;

  try {
    const record = await SwitchConfiguration.findByPk(id, {
      include: [
        {
          model: Device,
          attributes: ["ip", "name"],
          required: false,
        },
      ],
    });

    if (!record) {
      return res.status(404).json({ message: "Configuration not found" });
    }

    const filePath = record.filePath;
    if (!filePath) {
      return res.status(404).json({ message: "File path not found" });
    }

    const resolvedBase = path.resolve(baseDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
      return res.status(400).json({ message: "Invalid file path" });
    }

    await fs.promises.access(resolvedFile, fs.constants.R_OK);

    const safeName = sanitizeFilenamePart(record.deviceName || record.device?.name || "switch");
    const safeIp = sanitizeFilenamePart(record.device?.ip || "unknown");
    const fileName = `${safeName}_${safeIp}.txt`;

    return res.download(resolvedFile, fileName);
  } catch (error) {
    console.error("Error downloading switch configuration:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
