const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op } = require("sequelize");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
  };

  // === DATABASE MODELS ===
  const diacustomer = db.diacustomers;
  const customerinfo = db.customerinfos;
  const iptcustomers = db.iptcustomers;
  const iptcustomerinfos = db.iptcustomerinfos;
  const sharedcustomers = db.sharedcustomers;
  const sharedcustomerinfos = db.sharedcustomerinfos;
  const l3vpncustomers = db.l3vpncustomers;
  const l3vpncustomersinfo = db.l3vpncustomerinfos

  // === SWITCH INFO ===
  const bng = [
    { name: "LTZ-BNG02-TIG-DAR", host: "41.175.38.42" },
    { name: "LTZ-BNG02-RAH-DAR", host: "41.175.38.43" },
  ];

  const pe = [
    { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
    { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
  ];

  const p = [{ name: "LTZ-P1-DAR", host: "197.155.94.114" }];

  const acc = [
    { name: "LTZ-ACC2-RAH", host: "41.175.37.20" },
    { name: "LTZ-ACC3-RAH", host: "41.175.37.21" },
  ];

  const normalize = (v) => String(v || "").trim().toLowerCase();
  const buildActiveKey = (switchName, iface) => `${normalize(switchName)}::${normalize(iface)}`;

  // === HELPER FUNCTIONS ===
  // Run command over SSH
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

  // Get active interfaces from network devices
  const getActiveInterfacesFromNetwork = async () => {
    console.log("[Cleanup] Fetching active interfaces from network devices...");

    const activeBySwitchAndInterface = new Set();
    const activeInterfaceNames = new Set();

    try {
      // Get interfaces from BNG switches
      const bngResults = await Promise.allSettled(
        bng.map(async (sw) => {
          console.log(`[Cleanup] Fetching from BNG ${sw.name}...`);
          const output = await runCommand(sw.host, "show interfaces descriptions");
          return parseInterfaces(output, sw.name);
        })
      );

      // Get interfaces from PE devices
      const peResults = await Promise.allSettled(
        pe.map(async (p) => {
          console.log(`[Cleanup] Fetching from PE ${p.name}...`);
          const output = await runCommand(p.host, "show interfaces descriptions");
          return parseInterfaces(output, p.name);
        })
      );

      // Get interfaces from P devices for IPT
      const pResults = await Promise.allSettled(
        p.map(async (pr) => {
          console.log(`[Cleanup] Fetching from P ${pr.name}...`);
          const output = await runCommand(pr.host, "show interfaces descriptions");
          return parseInterfaces(output, pr.name);
        })
      );

      // Get interfaces from ACC switches for Shared customers
      const accResults = await Promise.allSettled(
        acc.map(async (ac) => {
          console.log(`[Cleanup] Fetching from ACC ${ac.name}...`);
          let output = "";
          if (ac.name.includes("ACC2")) {
            output = await runCommand(ac.host, "show configuration |display set |match ge-0/0/63 |match virtual-circuit-id");
          } else if (ac.name.includes("ACC3")) {
            output = await runCommand(ac.host, "show configuration |display set |match ge-0/0/36 |match virtual-circuit-id");
          }
          return parseInterfaces(output, ac.name);
        })
      );

      // Process results and collect active interfaces
      [...bngResults, ...peResults, ...pResults, ...accResults].forEach(result => {
        if (result.status === "fulfilled") {
          result.value.forEach((entry) => {
            if (!entry?.interface) return;
            activeInterfaceNames.add(normalize(entry.interface));
            if (entry.switchName) {
              activeBySwitchAndInterface.add(buildActiveKey(entry.switchName, entry.interface));
            }
          });
        } else {
          console.error("[Cleanup] Error fetching from device:", result.reason.message);
        }
      });

      console.log(`[Cleanup] Found ${activeInterfaceNames.size} active interface names on network`);
      console.log(`[Cleanup] Found ${activeBySwitchAndInterface.size} active switch+interface pairs on network`);
      return { activeBySwitchAndInterface, activeInterfaceNames };

    } catch (error) {
      console.error("[Cleanup] Error fetching active interfaces:", error.message);
      return new Set();
    }
  };

  // Parse interfaces from command output
  const parseInterfaces = (output, switchName) => {
    if (!output) return [];

    return output
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const trimmed = line.trim();

        // Handle different output formats:
        // 1. show interfaces descriptions format: "ps4405.1    up    up    customer info..."
        // 2. show configuration format: "set interfaces ge-0/0/63.1007 circuit-id \"customer-info\""
        // 3. show configuration format: "set interfaces ge-0/0/36.2001 circuit-id \"customer-info\""

        if (trimmed.startsWith("ps")) {
          // Original format for BNG/PE/P switches
          const match = trimmed.split(/\s+/);
          return { switchName, interface: match[0] }; // e.g., ps4405.1
        } else if (trimmed.startsWith("set protocols l2circuit")) {
          // New format for ACC switches - keep in ge format to match database
          const match = trimmed.match(/interface ([^\s]+).*virtual-circuit-id/);
          if (match) {
            return { switchName, interface: match[1] }; // e.g., ge-0/0/63.1007
          }
        }

        return null;
      })
      .filter(entry => entry !== null);
  };

  const isInterfaceActive = (customer, activeSets) => {
    const iface = normalize(customer?.interface);
    if (!iface) return false;

    const sw = normalize(customer?.switchName);
    if (sw) {
      return activeSets.activeBySwitchAndInterface.has(buildActiveKey(sw, iface));
    }

    // Legacy fallback for rows that do not have switchName populated.
    return activeSets.activeInterfaceNames.has(iface);
  };

  // Clean up DIA customers
  const cleanupDIACustomers = async (activeSets) => {
    console.log("[Cleanup DIA] Starting cleanup...");

    try {
      // Get all DIA customers from database
      const diaCustomers = await diacustomer.findAll({
        attributes: ["id", "interface", "switchName"],
        raw: true
      });

      console.log(`[Cleanup DIA] Found ${diaCustomers.length} DIA customers in database`);

      // Find customers not in active interfaces
      const staleCustomers = diaCustomers.filter(customer =>
        !isInterfaceActive(customer, activeSets)
      );

      console.log(`[Cleanup DIA] Found ${staleCustomers.length} stale DIA customers to remove`);

      if (staleCustomers.length > 0) {
        // Remove from diacustomers table
        const staleIds = staleCustomers.map(c => c.id);
        await diacustomer.destroy({
          where: { id: { [Op.in]: staleIds } }
        });

        // Also remove from customerinfos table
        await customerinfo.destroy({
          where: { interface: { [Op.in]: staleCustomers.map(c => c.interface) } }
        });

        console.log(`[Cleanup DIA] Removed ${staleCustomers.length} stale DIA customers and their info records`);
      }

      return staleCustomers.length;

    } catch (error) {
      console.error("[Cleanup DIA] Error:", error.message);
      return 0;
    }
  };

  // clean up L3VPN customers
  const cleanupL3VPNCustomers = async (activeSets) => {
    console.log("[Cleanup L3VPN] Starting cleanup...");

    try {
      // Get all L3VPN customers from database
      const l3vpnCustomers = await l3vpncustomers.findAll({
        attributes: ["id", "interface", "switchName"],
        raw: true
      });

      console.log(`[Cleanup L3VPN] Found ${l3vpnCustomers.length} L3VPN customers in database`);

      // Find customers not in active interfaces
      const staleCustomers = l3vpnCustomers.filter(customer =>
        !isInterfaceActive(customer, activeSets)
      );

      console.log(`[Cleanup L3VPN] Found ${staleCustomers.length} stale L3VPN customers to remove`);

      if (staleCustomers.length > 0) {
        // Remove from l3vpncustomers table
        const staleIds = staleCustomers.map(c => c.id);
        await l3vpncustomers.destroy({
          where: { id: { [Op.in]: staleIds } }
        });

        // Also remove from l3vpncustomerinfos table
        await l3vpncustomersinfo.destroy({
          where: { interface: { [Op.in]: staleCustomers.map(c => c.interface) } }
        });

        console.log(`[Cleanup L3VPN] Removed ${staleCustomers.length} stale L3VPN customers and their info records`);
      }

      return staleCustomers.length;

    } catch (error) {
      console.error("[Cleanup L3VPN] Error:", error.message);
      return 0;
    }
  };

  // Clean up IPT customers
  const cleanupIPTCustomers = async (activeSets) => {
    console.log("[Cleanup IPT] Starting cleanup...");

    try {
      // Get all IPT customers from database
      const iptCustomers = await iptcustomers.findAll({
        attributes: ["id", "interface", "switchName"],
        raw: true
      });

      console.log(`[Cleanup IPT] Found ${iptCustomers.length} IPT customers in database`);

      // Find customers not in active interfaces
      const staleCustomers = iptCustomers.filter(customer =>
        !isInterfaceActive(customer, activeSets)
      );

      console.log(`[Cleanup IPT] Found ${staleCustomers.length} stale IPT customers to remove`);

      if (staleCustomers.length > 0) {
        // Remove from iptcustomers table
        const staleIds = staleCustomers.map(c => c.id);
        await iptcustomers.destroy({
          where: { id: { [Op.in]: staleIds } }
        });

        // Also remove from iptcustomerinfos table
        await iptcustomerinfos.destroy({
          where: { interface: { [Op.in]: staleCustomers.map(c => c.interface) } }
        });

        console.log(`[Cleanup IPT] Removed ${staleCustomers.length} stale IPT customers and their info records`);
      }

      return staleCustomers.length;

    } catch (error) {
      console.error("[Cleanup IPT] Error:", error.message);
      return 0;
    }
  };

  // Clean up Shared customers
  const cleanupSharedCustomers = async (activeSets) => {
    console.log("[Cleanup Shared] Starting cleanup...");

    try {
      // Get all Shared customers from database
      const sharedCustomers = await sharedcustomers.findAll({
        attributes: ["id", "interface", "switchName"],
        raw: true
      });

      console.log(`[Cleanup Shared] Found ${sharedCustomers.length} Shared customers in database`);

      // Find customers not in active interfaces
      const staleCustomers = sharedCustomers.filter(customer =>
        !isInterfaceActive(customer, activeSets)
      );

      console.log(`[Cleanup Shared] Found ${staleCustomers.length} stale Shared customers to remove`);

      if (staleCustomers.length > 0) {
        // Remove from sharedcustomers table
        const staleIds = staleCustomers.map(c => c.id);
        await sharedcustomers.destroy({
          where: { id: { [Op.in]: staleIds } }
        });

        // Also remove from sharedcustomerinfos table
        await sharedcustomerinfos.destroy({
          where: { interface: { [Op.in]: staleCustomers.map(c => c.interface) } }
        });

        console.log(`[Cleanup Shared] Removed ${staleCustomers.length} stale Shared customers and their info records`);
      }

      return staleCustomers.length;

    } catch (error) {
      console.error("[Cleanup Shared] Error:", error.message);
      return 0;
    }
  };

  // Main cleanup function
  const cleanupStaleCustomers = async () => {
    console.log(`\n[Stale Customer Cleanup] Started at ${new Date().toISOString()}`);

    try {
      // Get active interfaces from network
      const activeSets = await getActiveInterfacesFromNetwork();

      if (activeSets.activeInterfaceNames.size === 0) {
        console.log("[Stale Customer Cleanup] No active interfaces found on network, skipping cleanup");
        return;
      }

      // Clean up each customer type
      const diaRemoved = await cleanupDIACustomers(activeSets);
      const iptRemoved = await cleanupIPTCustomers(activeSets);
      const sharedRemoved = await cleanupSharedCustomers(activeSets);
      const l3vpnRemoved = await cleanupL3VPNCustomers(activeSets);

      const totalRemoved = diaRemoved + iptRemoved + sharedRemoved + l3vpnRemoved;

      console.log(`\n[Stale Customer Cleanup] Summary:`);
      console.log(`- DIA customers removed: ${diaRemoved}`);
      console.log(`- IPT customers removed: ${iptRemoved}`);
      console.log(`- Shared customers removed: ${sharedRemoved}`);
      console.log(`- L3VPN customers removed: ${l3vpnRemoved}`);
      console.log(`- Total customers removed: ${totalRemoved}`);
      

      // Emit notification if customers were removed
      if (totalRemoved > 0 && io) {
        io.emit("staleCustomersCleaned", {
          message: `Cleaned up ${totalRemoved} stale customer records`,
          diaRemoved,
          iptRemoved,
          sharedRemoved,
          l3vpnRemoved,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error("[Stale Customer Cleanup] Fatal error:", error.message);
    }

    console.log(`[Stale Customer Cleanup] Finished at ${new Date().toISOString()}\n`);
  };

  if (options.schedule !== false) {
    cron.schedule("0 2 * * *", cleanupStaleCustomers);
    console.log("[Stale Customer Cleanup] Cron job scheduled to run daily at 2:00 AM");
  }

  return {
    cleanupStaleCustomers
  };
};
