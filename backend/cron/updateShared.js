const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const { trackStatusChanges, getSharedCustomerInfoMap } = require("../utils/statusTracker");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 2,
  };

  const Device = db.devices;
  const sharedcustomers = db.sharedcustomers;
  const sharedcustomerinfos = db.sharedcustomerinfos;

  const acc2_raha = [
    { name: "LTZ-ACC2-RAH", host: "41.175.37.20" }
  ]

  const acc3_raha = [
    { name: "LTZ-ACC3-RAH", host: "41.175.37.21" }
  ]

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

      .filter((line) => line.startsWith("ge"))

      .filter((line) => line.trim() !== "")

      .map((line) => {
        const match = line.trim().split(/\s+/);

        return {
          interface: match[0],

          adminStatus: match[1],

          operationalStatus: match[2],

          description: match.slice(3).join(" "),

          switchName,
        };
      });
  };

  const parseCustomerInfo = (intf) => {
    const desc = intf.description || "";

    const info = {
      interface: intf.interface,
      nbr: "",
      port: "",
      customerName: "",
      capacity: 0
    };

    // Capture ALL key=value pairs, case-insensitive
    const attributes = {};
    const regex = /(\w+)\s*=\s*([^|]+)/gi;

    let match;
    while ((match = regex.exec(desc)) !== null) {
      const key = match[1].toLowerCase(); // normalize key
      const value = match[2].trim();
      attributes[key] = value;
    }

    // Handle NBR + Port combined formats
    // Example: nbr=LTZ-ACC1-HEA ge-0/0/45
    const nbrPortMatch = desc.match(/nbr\s*=\s*([^\s|]+)\s*([^\s|]+)?/i);

    if (nbrPortMatch) {
      info.nbr = nbrPortMatch[1]?.trim() || "";
      info.port = nbrPortMatch[2]?.trim() || "";
    }

    // Get customer name using normalized keys
    info.customerName = attributes["customer"] || attributes["cust"] || "";

    // Get capacity from Mbps=value
    info.capacity = parseInt(attributes["mbps"], 10) || 0;

    // Fallback for weird cases with stray |value|
    if (!info.customerName) {
      const orphanCust = desc.match(/\|([^|=]+)\|/);
      if (orphanCust) info.customerName = orphanCust[1].trim();
    }

    // Ignore if no customer info detected
    if (!info.customerName) return null;

    return info;
  };

  const upsertCustomerInfo = async (allInterfaces) => {
    const customerRecords = allInterfaces
      .map(parseCustomerInfo)

      .filter((c) => c !== null);

    if (customerRecords.length > 0) {
      await sharedcustomerinfos.bulkCreate(customerRecords, {
        updateOnDuplicate: ["nbr", "port", "customerName","capacity"],
      });

      console.log(
        `[CustomerInfo] Upsert done. Processed ${customerRecords.length} records.`
      );
    }
  };

  // Parse CID from output like:
  // set protocols l2circuit neighbor 41.175.37.20 interface ge-0/0/36.3040 virtual-circuit-id 2554900787
  const parseInterfaceCid = (output) => {
    if (!output) {
      console.log("[parseInterfaceCid] ⚠️ Empty output received");
      return new Map();
    }

    const map = new Map();
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    // Regex to capture: interface ge-0/0/XX.XXXX virtual-circuit-id XXXXXXXXXX
    const regex = /interface\s+(ge-\d+\/\d+\/\d+\.\d+)\s+virtual-circuit-id\s+(\d+)/i;

    for (const line of lines) {
      const match = line.match(regex);

      if (match) {
        const iface = match[1]; // ge-0/0/36.3040
        let cid = match[2];     // 2554900787

        // Transform CID: 2554900787 → LTZ4900787
        if (cid.startsWith("255")) {
          cid = "LTZ" + cid.substring(3);
        }

        map.set(iface, cid);
        console.log(`[parseInterfaceCid] Mapped ${iface} → ${cid}`);
      }
    }

    console.log(`[parseInterfaceCid] Total parsed: ${map.size}`);
    return map;
  };

  const fetchInterfaceCid = async () => {
    // Find records that need CID lookup
    const needCid = await sharedcustomerinfos.findAll({
      where: { cid: { [Op.is]: null } },
    });

    console.log(`[Shared Updater] ${needCid.length} records need circuit id lookup.`);

    const cidMap = new Map();

    // Define switches with their specific commands
    const switchCommands = [
      {
        ...acc2_raha[0],
        cmd: 'show configuration |display set |match ge-0/0/63 |match circuit-id'
      },
      {
        ...acc3_raha[0],
        cmd: 'show configuration |display set |match ge-0/0/36 |match circuit-id'
      }
    ];

    // 1. Fetch CID data from each switch
    const switchResults = await Promise.allSettled(
      switchCommands.map(async (sw) => {
        console.log(`[Shared Updater] Fetching CID from ${sw.name} (${sw.host})...`);
        console.log(`[Shared Updater] Command: ${sw.cmd}`);
        
        const output = await runCommand(sw.host, sw.cmd);
        return { sw, map: parseInterfaceCid(output) };
      })
    );

    // 2. Merge all switch maps into one central cidMap
    for (const result of switchResults) {
      if (result.status === "fulfilled") {
        for (const [key, val] of result.value.map.entries()) {
          if (!cidMap.has(key)) cidMap.set(key, val);
        }
        console.log(`[Shared Updater] ✅ Fetched from ${result.value.sw.name}`);
      } else {
        console.error(`[Shared Updater] ❌ Error fetching CID:`, result.reason.message);
      }
    }
    console.log(`[Shared Updater] Merged CID map size: ${cidMap.size}`);

    // 3. Apply CIDs to records
    const updates = [];
    for (const rec of needCid) {
      const cid = cidMap.get(rec.interface); // Match full interface like ge-0/0/36.3040

      if (cid) {
        if (cid !== rec.cid) {
          rec.cid = cid;
          updates.push(rec);
        }
      } else {
        console.log(`[Shared Updater] ⚠️ No CID found for ${rec.interface}`);
      }
    }

    // 4. Perform bulk update
    if (updates.length > 0) {
      await sharedcustomerinfos.bulkCreate(
        updates.map((rec) => ({
          id: rec.id,
          interface: rec.interface,
          port: rec.port,
          nbr: rec.nbr,
          customerName: rec.customerName,
          cid: rec.cid,
          capacity: rec.capacity,
        })),
        {
          updateOnDuplicate: ["cid"],
        }
      );
      console.log(`[Shared Updater] ✅ Updated ${updates.length} records with CID.`);
    } else {
      console.log(`[Shared Updater] ℹ️ No new CIDs to update.`);
    }
  };

  // === MAIN UPDATER FUNCTION ===
  const updateShared = async () => {
    console.log(`[Shared Updater] Started at ${new Date().toISOString()}`);

    try {
      // === Step 1: Pull interface descriptions ===
      const acc2_rahaResults = await Promise.all(
        acc2_raha.map(async (sw) => {
          console.log(`[Shared Updater] Fetching from ${sw.name}...`);
          const descOutput = await runCommand(sw.host, "show interfaces descriptions | match ge-0/0/63 | match cat" );

          const parsed = parseInterfaces(descOutput, sw.name);

          console.log(`[Shared Updater] ${sw.name} returned ${parsed.length} interfaces`);
          return parsed;
        })
      )

      const acc3_rahaResults = await Promise.all(
        acc3_raha.map(async (sw) => {
          console.log(`[Shared Updater] Fetching from ${sw.name}...`);
          const descOutput = await runCommand(sw.host, "show interfaces descriptions |match ge-0/0/36 | match cat" );
          const parsed = parseInterfaces(descOutput, sw.name);
          console.log(`[Shared Updater] ${sw.name} returned ${parsed.length} interfaces`);
          return parsed;
        })
      )

      let allInterfaces = [...acc2_rahaResults.flat(), ...acc3_rahaResults.flat()];
      console.log(allInterfaces.length)

      // === STATUS CHANGE TRACKING ===
      console.log("[Shared Updater] Tracking status changes...");
      const customerInfoMap = await getSharedCustomerInfoMap();
      await trackStatusChanges(allInterfaces, "SHARED", customerInfoMap);
      // === END STATUS CHANGE TRACKING ===

      await sharedcustomers.bulkCreate(allInterfaces, {
        updateOnDuplicate: [
          "adminStatus",
          "operationalStatus",
          "description",
          "switchName",
        ],
      });

      console.log("[DIA Updater] Bulk insert/update done for sharedcustomers.");

      // === Step 2: Upsert customerinfo ===
      await upsertCustomerInfo(allInterfaces);
        // === Step 3: Fetch Circuit id ====
      await fetchInterfaceCid();
    } catch (error) {
      console.error("[IPT Updater] Fatal error:", err.message);
    }
    console.log("[shared Updater] Finished run.\n");

  }

  const runAll = async () => {
    const [[{ acquired }]] = await db.sequelize.query(
      "SELECT GET_LOCK('shared_cron_update', 0) AS acquired"
    );
    if (!acquired) {
      if (process.env.LOG_LOCK_SKIPS === "1") {
        console.warn("[Shared] Another instance is already running — skipping this tick.");
      }
      return;
    }
    try {
      await updateShared(); // ✅ Run first
    } catch (err) {
      console.error("[Main Runner] Fatal error:", err.message);
    } finally {
      await db.sequelize.query("SELECT RELEASE_LOCK('shared_cron_update')");
    }
  };
  if (options.schedule !== false) {
    cron.schedule("2,7,12,17,22,27,32,37,42,47,52,57 * * * *", runAll);
    console.log("[Shared] Sync cron job scheduled with 2-minute offset.");
  }

  return {  
    updateShared,
  };
}