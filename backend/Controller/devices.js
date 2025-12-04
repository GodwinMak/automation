// const e = require("express");
const db = require("../Models")
// const data = require("../devices.json")
const { Client } = require("ssh2");
const ip = require("ip");


const Device = db.devices;
const User = db.users;

//create device single
exports.createDevice = async (req, res) => {
    const { ip, name } = req.body;
    if (!ip || !name) {
        return res.status(400).json({ message: "IP and name are required" });
    }
    try {
        const deviceExists = await Device.findOne({ where: { ip } }); 
        if (deviceExists) {
            return res.status(400).json({ message: "Device with this IP already exists" });
        }
        const newDevice = await Device.create({ ip, name });
        res.status(201).json(newDevice);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}
// create device bulk
exports.createDevicesBulk = async (req, res) => {
    const devices = req.body.devices; // Expecting an array of devices
    if (!Array.isArray(devices) || devices.length === 0) {
        return res.status(400).json({ message: "Devices array is required" });
    }
    try {
        const createdDevices = [];
        for (const device of devices) {
            const { ip, name } = device;
            if (!ip || !name) {
                return res.status(400).json({ message: "Each device must have IP and name" });
            }
            const deviceExists = await Device.findOne({ where: { ip } });
            if (deviceExists) {
                return res.status(400).json({ message: `Device with IP ${ip} already exists` });
            }
            const newDevice = await Device.create({ ip, name });
            createdDevices.push(newDevice);
        }
        res.status(201).json(createdDevices);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}
// Add this to your backend's devices controller
exports.getAllDevices = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 5;
    const offset = (page - 1) * pageSize;
    const searchQuery = req.query.search || '';

    try {
        const { count, rows } = await Device.findAndCountAll({
            offset,
            limit: pageSize,
            where: {
                name: {
                    [db.Sequelize.Op.like]: `%${searchQuery}%`
                }
            }
        });

        const totalPages = Math.ceil(count / pageSize);

        res.status(200).json({
            devices: rows,
            totalItems: count,
            totalPages,
            currentPage: page
        });
    } catch (error) {
        console.error("Error fetching devices:", error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};
// get single device
exports.getDeviceById = async (req, res) => {
    const { id } = req.params;
    try {
        const device = await Device.findByPk(id);
        if (!device) {
            return res.status(404).json({ message: "Device not found" });
        }
        res.status(200).json(device);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}
// update device
exports.updateDevice = async (req, res) => {
    const { id } = req.params;
    const { ip, name } = req.body;
    try {
        const device = await Device.findByPk(id);
        if (!device) {
            return res.status(404).json({ message: "Device not found" });
        }
        if (ip) device.ip = ip;
        if (name) device.name = name;
        await device.save();
        res.status(200).json(device);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}
// delete device
exports.deleteDevice = async (req, res) => {
    const { id } = req.params;
    try {
        const device = await Device.findByPk(id);
        if (!device) {
            return res.status(404).json({ message: "Device not found" });
        }
        await device.destroy();
        res.status(200).json({ message: "Device deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}


exports.getInterfacesUp = async (req, res) => {
  const { deviceId, password, email } = req.body;

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }


    const device = await Device.findByPk(deviceId);
    if (!device) return res.status(404).json({ message: "Device not found" });

    const username = user.username;

    const conn = new Client();

    conn.on("ready", () => {
      conn.exec('show interfaces descriptions | match up | except down', (err, stream) => {
        if (err) return res.status(500).json({ error: err.message });

        let output = "";

        stream.on("data", (data) => {
          output += data.toString();
        });

        stream.on("close", () => {
          conn.end();
          const interfaces = output
            .split("\n")
            .filter((line) => line.startsWith("ps"))
            .filter((line) => line.trim() !== "")
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              return {
                interface: parts[0],   // e.g. ge-0/0/1
                adminStatus: parts[1],
                operationalStatus: parts[2],
                description: parts.slice(3).join(" ") || "", // description if any
              };
            });

          res.json({ device: device.name, interfaces });
        });
      });
    });

    conn.on("error", (err) => {
      return res.status(500).json({ error: "SSH error: " + err.message });
    });

    conn.connect({
      host: device.ip,
      username,
      password,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getCustomersByIp = async (req, res) => {
  try {
    const ipList = req.body; // expecting [{ ip_address: "..." }, {...}]
    if (!Array.isArray(ipList) || ipList.length === 0) {
      return res.status(400).json({ message: "Invalid input" });
    }

    // Fetch all DIACustomer entries that have a destination
    const diaCustomers = await db.diacustomers.findAll({
      where: { destination: { [db.Sequelize.Op.ne]: null } },
      include: [{ model: db.customerinfos }],
    });

    const results = [];

    for (const ipObj of ipList) {
      const targetIp = ipObj.ip_address;

      // Find matching DIACustomer whose destination subnet includes this IP
      for (const dia of diaCustomers) {
        const dest = dia.destination; // e.g., "196.41.56.148/30"
        if (!dest) continue;

        // Check if IP belongs to subnet
        if (ip.cidrSubnet(dest).contains(targetIp)) {
          // get all customerinfos for this interface
          dia.customerinfos.forEach((c) => {
            results.push({
              ip_address: targetIp,
              customerName: c.customerName,
              cid: c.cid,
              nbr: c.nbr,
              port: c.port,
            });
          });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};