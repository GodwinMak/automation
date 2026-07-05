const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const {
  trackStatusChanges,
  getL3vpnCustomerInfoMap,
} = require("../utils/statusTracker");
const { enqueueBatch } = require("../utils/warehouseSpool");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 2,
  };

  // === DATABASE MODELS ===
  const l3vpncustomer = db.l3vpncustomers;
  const l3vpncustomerinfo = db.l3vpncustomerinfos;
  const Device = db.devices;

  const pe = [
    { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
    { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
  ];

  const agg = [
    { name: "LTZ-AGG1-RAH", host: "41.175.37.5" },
    { name: "LTZ-AGG1-TIG", host: "41.175.37.6" },
  ];

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

  // Parse interface descriptions and destination IPs from a single output
  const parseInterfaces = (output, switchName) => {
    return output

      .split("\n")

      .filter((line) => line.startsWith("ps"))

      .filter((line) => line.trim() !== "")

      .map((line) => {
        const match = line.trim().split(/\s+/);

        return {
          interface: match[0],

          adminStatus: match[1],

          operationalStatus: match[2],

          description: match.slice(3).join(" "),

          switchName,

          destination: null,
        };
      });
  };

  // Parse customer info from description
  const parseCustomerInfo = (intf) => {
    const desc = intf.description || "";

    const info = {
      interface: intf.interface,
      nbr: "",
      port: "",
      customerName: "",
    };

    // Step 1: Find all key-value pairs in the description

    const attributes = {};

    const regex = /(\w+)\s*=\s*([^|]+)/g; // Captures "key=value" pairs

    let match;

    while ((match = regex.exec(desc)) !== null) {
      attributes[match[1].toLowerCase()] = match[2].trim();
    }

    // Step 2: Use the collected attributes to populate the info object

    const cat = attributes["cat"] || attributes["CAT"];

    if (cat && cat.toLowerCase() === "mgmt") {
      return null; // Explicitly ignore MGMT interfaces
    }

    // Handle NBR and Port separately as they're often combined

    const nbrPortMatch = desc.match(/nbr=([^\s|]+)\s*\|?\s*([^\s|]+)/i);

    if (nbrPortMatch) {
      info.nbr = nbrPortMatch[1].trim();

      info.port = nbrPortMatch[2] ? nbrPortMatch[2].trim() : "";
    }

    // Get Customer Name, handling different keys

    info.customerName =
      attributes["customer"] || attributes["cust"] || attributes["cname"] || "";

    if (!info.customerName) {
      const orphanCustMatch = desc.match(/\|([^|=]+)\|/);

      if (orphanCustMatch) info.customerName = orphanCustMatch[1].trim();
    }

    // Step 4: Final validation - only process if we found a CID or Customer Name

    if (!info.cid && !info.customerName) {
      return null;
    }

    return info;
  };

  const upsertCustomerInfo = async (allInterfaces) => {
    const customerRecords = allInterfaces
      .map(parseCustomerInfo)

      .filter((c) => c !== null);

    if (customerRecords.length > 0) {
      await l3vpncustomerinfo.bulkCreate(customerRecords, {
        updateOnDuplicate: ["nbr", "port", "customerName"],
      });
    }
  };

  // Parse policing rates from detail
  const parsePolicerOutput = (output) => {
    if (!output) {
      return new Map();
    }

    const lines = output

      .split("\n")

      .map((l) => l.trim())

      .filter(Boolean);

    const map = new Map();

    for (const line of lines) {
      const match = line.match(
        /^set interfaces (\S+) unit (\d+) layer2-policer (input-policer|output-policer) (\S+-POLICER)$/i,
      );

      if (!match) {
        continue;
      }

      // const [, ifName, unit, direction, policerName] = match;

      let direction = match[3];

      const key = `${match[1]}.${match[2]}`;

      let policerName = match[4]; // e.g. "150-MBPS-POLICER"

      const valMatch = policerName.match(/(\d+)-?([mMgG])BPS/i);

      let mbps = null;

      if (valMatch) {
        const num = parseInt(valMatch[1], 10);

        const unitChar = valMatch[2].toLowerCase();

        mbps = unitChar === "g" ? num * 1000 : num;
      }

      if (!map.has(key)) map.set(key, { downmbps: null, upmbps: null });

      const entry = map.get(key);

      if (direction.toLowerCase().includes("input")) {
        entry.upmbps = mbps; // input-policer → upmbps
      } else if (direction.toLowerCase().includes("output")) {
        entry.downmbps = mbps; // output-policer → downmbps
      }
    }

    return map;
  };

  const updateBandwidths = async () => {
    console.log("[BandwidthUpdater] Fetching policers...");

    try {
      // Step 1: Fetch policer data concurrently for all switches
      const allDevices = [...pe];
      const switchResults = await Promise.allSettled(
        allDevices.map(async (sw) => {
          const cmd = `show configuration interfaces | display set | match "policer"`;

          const output = await runCommand(sw.host, cmd);
          return { sw, map: parsePolicerOutput(output) };
        }),
      );

      // Step 2: Merge all switch maps

      const policerMap = new Map();

      for (const result of switchResults) {
        if (result.status === "fulfilled") {
          for (const [key, val] of result.value.map.entries()) {
            if (!policerMap.has(key)) policerMap.set(key, val);
          }
        } else {
        }
      }

      // Step 3: Fetch all customer infos

      const infos = await l3vpncustomerinfo.findAll();

      // Step 4: Build updates

      const updates = [];

      for (const info of infos) {
        const entry = policerMap.get(info.interface);

        if (!entry) {
          continue;
        }

        const updateObj = {};

        if (entry.downmbps !== null && entry.downmbps !== info.downmbps) {
          updateObj.downmbps = entry.downmbps;
        }

        if (entry.upmbps !== null && entry.upmbps !== info.upmbps) {
          updateObj.upmbps = entry.upmbps;
        }

        if (Object.keys(updateObj).length > 0) {
          updates.push({
            id: info.id,

            interface: info.interface, // ✅ include interface

            nbr: info.nbr,

            port: info.port,

            customerName: info.customerName,

            cid: info.cid,

            ...updateObj,
          });
        }
      }

      // Step 5: Bulk update

      if (updates.length > 0) {
        await l3vpncustomerinfo.bulkCreate(updates, {
          updateOnDuplicate: ["downmbps", "upmbps"],
        });

        console.log(
          `[BandwidthUpdater] ✅ Updated ${updates.length} customer records`,
        );
      } else {
        console.log("[BandwidthUpdater] ℹ️ No updates needed");
      }
    } catch (err) {
      console.error("[BandwidthUpdater] ❌ Fatal error:", err.message);
    }
  };

  const parseInterfaceAddresses = (output) => {
    if (!output) {
      return new Map();
    }

    const map = new Map();
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Regex to match: set interfaces (psX) unit (Y) family inet address (A.B.C.D/Z)
    const regex =
      /^set interfaces (\S+) unit (\d+) family inet address (\d{1,3}(?:\.\d{1,3}){3}\/\d+)$/i;

    for (const line of lines) {
      const match = line.match(regex);

      if (match) {
        const [
          ,
          ifName, // e.g., 'ps3557'
          unit, // e.g., '3557'
          cidr, // e.g., '154.72.85.217/30'
        ] = match;

        // The key is the full interface name (e.g., 'ps3557.3557')
        const key = `${ifName}.${unit}`;

        map.set(key, cidr);
        // Optional logging: console.log(`[parseInterfaceAddresses] Parsed ${key}: CIDR=${cidr}`);
      }
    }
    return map;
  };

  const parseInterfaceCid = (output) => {
    if (!output) {
      return new Map();
    }

    const map = new Map();
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    // Regex to capture: interface psXXXX.0 virtual-circuit-id XXXXXXXXXX
    const regex =
      /^set protocols l2circuit neighbor \S+ interface (ps\d+)\.\d+ virtual-circuit-id (\d+)$/i;

    for (const line of lines) {
      const match = line.match(regex);

      if (match) {
        let iface = match[1]; // ps2023
        let cid = match[2]; // 2552900001

        // Transform CID rule
        if (cid.startsWith("255")) {
          cid = "LTZ" + cid.substring(3); // 2552900001 → LTZ2900001
        }

        map.set(iface, cid);

        console.log(`[parseInterfaceCid] Mapped ${iface} → ${cid}`);
      }
    }

    console.log(`[parseInterfaceCid] Total parsed: ${map.size}`);

    return map;
  };

  // fetching customers address
  const fetchInterfaceAddresses = async () => {
    const needDest = await l3vpncustomer.findAll({
      where: { destination: { [Op.is]: null } },
    });

    const allDevices = [...pe];
    const addressMap = new Map();

    // 1. Fetch IP Address data concurrently for all devices
    const switchResults = await Promise.allSettled(
      allDevices.map(async (sw) => {
        // 🎯 The new command you requested
        const cmd = `show configuration interfaces | display set | match ps | match inet | match address`;
        const output = await runCommand(sw.host, cmd);

        return { sw, map: parseInterfaceAddresses(output) };
      }),
    );
    // 2. Merge all switch maps into one central addressMap
    for (const result of switchResults) {
      if (result.status === "fulfilled") {
        for (const [key, val] of result.value.map.entries()) {
          if (!addressMap.has(key)) addressMap.set(key, val);
        }
      } else {
      }
    }
    console.log(`[DIA Updater] Merged address map size: ${addressMap.size}`);

    // 3. Apply addresses to records and update the database
    const updates = [];
    for (const rec of needDest) {
      const address = addressMap.get(rec.interface);

      if (address) {
        // Only queue update if the address is found and is different (or if we only queried for NULLs)
        if (address !== rec.destination) {
          rec.destination = address; // Update in-memory
          updates.push(rec);
        }
      } else {
      }
    }

    // 4. Perform bulk update
    if (updates.length > 0) {
      await l3vpncustomer.bulkCreate(
        updates.map((rec) => ({
          id: rec.id,
          interface: rec.interface,
          destination: rec.destination,
        })),
        {
          updateOnDuplicate: ["destination"],
        },
      );

      console.log(
        `[DIA Updater] ✅ Updated ${updates.length} records with interface IP addresses.`,
      );
    } else {
      console.log(`[DIA Updater] ℹ️ No new interface IP addresses to update.`);
    }
  };

  const fetchInterfaceCid = async () => {
    const needDest = await l3vpncustomerinfo.findAll({
      where: { cid: { [Op.is]: null } },
    });

    const allDevices = [...pe];
    const cidMap = new Map();

    // 1. Fetch cid data concurrently for all devices

    const switchResults = await Promise.allSettled(
      allDevices.map(async (sw) => {
        //🎯 The new command you requested
        const cmd = `show configuration |display set |match ps |match circuit-id`;
        const output = await runCommand(sw.host, cmd);

        return { sw, map: parseInterfaceCid(output) };
      }),
    );

    // 2. Merge all switch mpas into one central addressMap
    for (const result of switchResults) {
      if (result.status === "fulfilled") {
        for (const [key, val] of result.value.map.entries()) {
          if (!cidMap.has(key)) cidMap.set(key, val);
        }
      } else {
      }
    }

    // 3. Apply addresses to reacords and update the database

    const updates = [];
    const getPrefix = (iface) => iface.split(".")[0];
    for (const rec of needDest) {
      const prefix = getPrefix(rec.interface); // psXXXX only
      const cid = cidMap.get(prefix);

      if (cid) {
        // only queue update if the address is found and is different (or if we only queried for NULLS)
        if (cid !== rec.cid) {
          rec.cid = cid;
          updates.push(rec);
        }
      } else {
      }
    }

    // 4. Perfrom bulk update
    if (updates.length > 0) {
      await l3vpncustomerinfo.bulkCreate(
        updates.map((rec) => ({
          id: rec.id,
          interface: rec.interface,
          port: rec.port,
          nbr: rec.nbr,
          customerName: rec.customerName,
          cid: rec.cid,
        })),
        {
          updateOnDuplicate: ["cid"],
        },
      );
    } else {
    }
  };

  const parseRouteInstances = (output) => {
    if (!output) return new Map();

    const map = new Map();
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Matches: set routing-instances IM-BANK interface ps1256.1256
    const regex = /^set routing-instances (\S+) interface (\S+)$/i;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const routeInstance = match[1];
        const iface = match[2];
        map.set(iface, routeInstance);
      }
    }

    return map;
  };

  const fetchInterfaceRouteInstances = async () => {
    const needRouteInstance = await l3vpncustomerinfo.findAll({
      where: { route_instance: { [Op.is]: null } },
    });

    if (needRouteInstance.length === 0) return;

    const allDevices = [...pe];
    const routeInstanceMap = new Map();

    // 1. Fetch route instance data concurrently for all devices
    const switchResults = await Promise.allSettled(
      allDevices.map(async (sw) => {
        const cmd = `show configuration |display set |match routing-instances |match interface`;
        const output = await runCommand(sw.host, cmd);
        return { sw, map: parseRouteInstances(output) };
      }),
    );

    // 2. Merge all switch maps
    for (const result of switchResults) {
      if (result.status === "fulfilled") {
        for (const [key, val] of result.value.map.entries()) {
          if (!routeInstanceMap.has(key)) routeInstanceMap.set(key, val);
        }
      }
    }

    // 3. Apply route instances to records
    const updates = [];
    for (const rec of needRouteInstance) {
      const routeInstance = routeInstanceMap.get(rec.interface);
      if (routeInstance && routeInstance !== rec.route_instance) {
        rec.route_instance = routeInstance;
        updates.push(rec);
      }
    }

    // 4. Bulk update
    if (updates.length > 0) {
      await l3vpncustomerinfo.bulkCreate(
        updates.map((rec) => ({
          id: rec.id,
          interface: rec.interface,
          port: rec.port,
          nbr: rec.nbr,
          customerName: rec.customerName,
          cid: rec.cid,
          route_instance: rec.route_instance,
        })),
        {
          updateOnDuplicate: ["route_instance"],
        },
      );
      console.log(
        `[RouteInstanceUpdater] ✅ Updated ${updates.length} records with route instances.`,
      );
    } else {
      console.log(
        `[RouteInstanceUpdater] ℹ️ No new route instances to update.`,
      );
    }
  };
  // === MAIN UPDATER FUNCTION ===
  const updateL3VPN = async () => {
    try {
      const peResults = await Promise.all(
        pe.map(async (p) => {
          console.log(`[DIA Updater] Fetching from PE ${p.name}...`);
          const cmd = "show interfaces descriptions | match L3VPN";
          const descOutput = await runCommand(p.host, cmd);
          const parsed = parseInterfaces(descOutput, p.name);
          return parsed;
        }),
      );

      let allInterfaces = [...peResults.flat()];

      // 1. Group all interfaces by their ID
      const groups = new Map();
      allInterfaces.forEach((intf) => {
        const list = groups.get(intf.interface) || [];
        list.push(intf);
        groups.set(intf.interface, list);
      });

      const finalInterfaces = [];

      for (const [name, matches] of groups) {
        // Prefer operationally Up entries; fall back to all if none are Up
        const upMatches = matches.filter(
          (m) => m.operationalStatus.toLowerCase() === "up",
        );
        const candidates = upMatches.length > 0 ? upMatches : matches;
        // Pick the first candidate (PE1-RAH takes precedence over PE1-TIG by array order)
        finalInterfaces.push(candidates[0]);
      }

      allInterfaces = finalInterfaces;

      await l3vpncustomer.bulkCreate(allInterfaces, {
        updateOnDuplicate: [
          "adminStatus",
          "operationalStatus",
          "description",
          "switchName",
        ],
      });

      // === STATUS CHANGE TRACKING ===
      const customerInfoMap = await getL3vpnCustomerInfoMap();
      await trackStatusChanges(allInterfaces, "L3VPN", customerInfoMap);
      // === END STATUS CHANGE TRACKING ===

      await upsertCustomerInfo(allInterfaces);
      // === Step 4: Fetch destinations ===
      await fetchInterfaceAddresses();
      // === Step 5: Fetch Circuit id ====
      await fetchInterfaceCid();
      // === Step 6: Fetch route instances ===
      await fetchInterfaceRouteInstances();
      // === Step 7: Update bandwidths via policers ===
      await updateBandwidths();

      // === Step 8: Warehouse tap ===
      const interfaceNames = allInterfaces.map((d) => d.interface);
      const [freshL3vpnRows, freshInfoRows] = await Promise.all([
        l3vpncustomer.findAll({ where: { interface: interfaceNames } }),
        l3vpncustomerinfo.findAll({ where: { interface: interfaceNames } }),
      ]);
      const infoByInterface = new Map(
        freshInfoRows.map((i) => [i.interface, i.toJSON()]),
      );
      const mergedRecords = freshL3vpnRows.map((d) => {
        const l3vpn = d.toJSON();
        const info = infoByInterface.get(l3vpn.interface) || {};
        return {
          record_key: l3vpn.interface,
          cid: info.cid || null,
          poll_ts: new Date(),
          payload: {
            interface: l3vpn.interface,
            switchName: l3vpn.switchName,
            adminStatus: l3vpn.adminStatus,
            operationalStatus: l3vpn.operationalStatus,
            description: l3vpn.description,
            destination: l3vpn.destination,
            nbr: info.nbr || null,
            port: info.port || null,
            customerName: info.customerName || null,
            cid: info.cid || null,
            upmbps: info.upmbps || null,
            downmbps: info.downmbps || null,
            route_instance: info.route_instance || null,
          },
        };
      });
      enqueueBatch("L3VPN", mergedRecords);
    } catch (error) {
      console.error("[L3VPN Updater] ❌ Error in updateL3VPN:", error.message);
    }
  };
  const runAll = async () => {
    const [[{ acquired }]] = await db.sequelize.query(
      "SELECT GET_LOCK('l3vpn_cron_update', 0) AS acquired",
    );
    if (!acquired) {
      if (process.env.LOG_LOCK_SKIPS === "1") {
        console.warn(
          "[L3VPN] Another instance is already running — skipping this tick.",
        );
      }
      return;
    }
    try {
      await updateL3VPN();
    } catch (error) {
      console.error("[L3VPN Updater] ❌ Error in runAll:", error.message);
    } finally {
      await db.sequelize.query("SELECT RELEASE_LOCK('l3vpn_cron_update')");
    }
  };

  if (options.schedule !== false) {
    cron.schedule("3,8,13,18,23,28,33,38,43,48,53,58 * * * *", runAll);
    console.log("[L3VPN] Sync cron job scheduled with 3-minute offset.");
  }

  return {
    updateL3VPN,
  };
};
