// === DEPENDENCIES ===
const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const { trackStatusChanges, getDiaCustomerInfoMap } = require("../utils/statusTracker");

require("dotenv").config({ path: "../.env" });

module.exports = (io) => {
  const sshConfig = {
    username: "godwin.makyao",
    password: "Namwel@842001!#@",
  };

  // === DATABASE MODELS ===
  const diacustomer = db.diacustomers;
  const customerinfo = db.customerinfos;
  const Device = db.devices;

  // === SWITCH INFO ===
  const switches = [
    { name: "LTZ-BNG02-TIG-DAR", host: "41.175.38.42" },
    { name: "LTZ-BNG02-RAH-DAR", host: "41.175.38.43" },
  ];

  const pe = [
    { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
    { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
  ];

  const agg = [
    { name: "LTZ-AGG1-RAH", host: "41.175.37.5" },
    { name: "LTZ-AGG1-TIG", host: "41.175.37.6" },
  ];
  // NEW: Function to handle sending notifications via Socket.IO
  const sendDownNotification = async (interfaceData) => {
    try {
      const customerDetails = await customerinfo.findOne({
        where: { interface: interfaceData.interface },
        attributes: ["customerName", "cid"],
      });

      const notificationPayload = {
        customerName: customerDetails?.customerName || "N/A",
        cid: customerDetails?.cid || "N/A",
        interface: interfaceData.interface,
        switchName: interfaceData.switchName,
        message: `Link for ${customerDetails?.customerName || "N/A"} (${
          interfaceData.interface
        }) went down.`,
        timestamp: new Date().toISOString(),
      };

      // --- REAL-TIME NOTIFICATION ---
      console.log("========================================");
      console.log(
        `🚀 Emitting 'linkDownAlert' to frontend for: ${notificationPayload.interface}`
      );
      console.log("========================================");

      // Use the 'io' object passed from server.js
      io.emit("linkDownAlert", notificationPayload);
    } catch (error) {
      console.error(
        `[Notification] Failed to process notification for ${interfaceData.interface}:`,
        error.message
      );
    }
  };
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

      // cid: "",
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

    // Get CID, handling different keys

    // info.cid = attributes["cid"] || attributes["sid"] || "";

    // Step 3: Handle orphaned CIDs or leftover names

    // const orphanCidMatch = desc.match(/\|\s*(LTZ\d+)\s*\|/i);

    // if (orphanCidMatch && !info.cid) {
    //   info.cid = orphanCidMatch[1];
    // }

    // Handle orphaned customer names

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
      await customerinfo.bulkCreate(customerRecords, {
        updateOnDuplicate: ["nbr", "port", "customerName"],
      });

      console.log(
        `[CustomerInfo] Upsert done. Processed ${customerRecords.length} records.`
      );
    }
  };

  // Parse policing rates from detail
  const parsePolicerOutput = (output) => {
    if (!output) {
      console.log("[parsePolicerOutput] ⚠️ Empty output received");

      return new Map();
    }

    const lines = output

      .split("\n")

      .map((l) => l.trim())

      .filter(Boolean);

    console.log(`[parsePolicerOutput] Processing ${lines.length} lines...`);

    const map = new Map();

    for (const line of lines) {
      const match = line.match(
        /^set interfaces (\S+) unit (\d+) layer2-policer (input-policer|output-policer) (\S+-POLICER)$/i
      );

      if (!match) {
        console.log(`[parsePolicerOutput] Skipping line: ${line}`);

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

      console.log(
        `[parsePolicerOutput] Parsed ${key}: direction=${direction}, mbps=${mbps}`
      );
    }

    console.log(
      `[parsePolicerOutput] Finished parsing. Found ${map.size} entries.`
    );

    return map;
  };

  const updateBandwidths = async () => {
    console.log("[BandwidthUpdater] Fetching policers...");

    try {
      // Step 1: Fetch policer data concurrently for all switches
      const allDevices = [...switches, ...pe];
      const switchResults = await Promise.allSettled(
        allDevices.map(async (sw) => {
          console.log(
            `[BandwidthUpdater] Running on ${sw.name} (${sw.host})...`
          );

          const cmd = `show configuration interfaces | display set | match "policer"`;

          const output = await runCommand(sw.host, cmd);

          console.log(
            `[BandwidthUpdater] Raw output from ${sw.name}:\n---\n${output}\n---`
          );

          return { sw, map: parsePolicerOutput(output) };
        })
      );

      // Step 2: Merge all switch maps

      const policerMap = new Map();

      for (const result of switchResults) {
        if (result.status === "fulfilled") {
          console.log(
            `[BandwidthUpdater] Parsed ${result.value.map.size} entries from ${result.value.sw.name}`
          );

          for (const [key, val] of result.value.map.entries()) {
            if (!policerMap.has(key)) policerMap.set(key, val);
          }
        } else {
          console.error(
            `[BandwidthUpdater] ❌ Error from switch:`,

            result.reason.message
          );
        }
      }

      console.log(
        `[BandwidthUpdater] Merged policer map size: ${policerMap.size}`
      );

      // Step 3: Fetch all customer infos

      const infos = await customerinfo.findAll();

      console.log(`[BandwidthUpdater] Loaded ${infos.length} customer infos`);

      // Step 4: Build updates

      const updates = [];

      for (const info of infos) {
        const entry = policerMap.get(info.interface);

        if (!entry) {
          console.log(`[BandwidthUpdater] No policer for ${info.interface}`);

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

          console.log(
            `[BandwidthUpdater] Queued update for ${info.interface}:`,

            updateObj
          );
        }
      }

      // Step 5: Bulk update

      if (updates.length > 0) {
        await customerinfo.bulkCreate(updates, {
          updateOnDuplicate: ["downmbps", "upmbps"],
        });

        console.log(
          `[BandwidthUpdater] ✅ Updated ${updates.length} customer records`
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
      console.log("[parseInterfaceAddresses] ⚠️ Empty output received");
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

    console.log(
      `[parseInterfaceAddresses] Found ${map.size} interface addresses.`
    );
    return map;
  };

  const parseInterfaceCid = (output) => {
    if (!output) {
      console.log("[pasrdeInterfaceCid]⚠️ Empty output received");

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
    const needDest = await diacustomer.findAll({
      where: { destination: { [Op.is]: null } },
    });
    console.log(`[DIA Updater] ${needDest.length} need destination lookup.`);

    const allDevices = [...switches, ...pe];
    const addressMap = new Map();

    // 1. Fetch IP Address data concurrently for all devices
    const switchResults = await Promise.allSettled(
      allDevices.map(async (sw) => {
        console.log(
          `[DIA Updater] Fetching addresses from ${sw.name} (${sw.host})...`
        );

        // 🎯 The new command you requested
        const cmd = `show configuration interfaces | display set | match ps | match inet | match address`;
        const output = await runCommand(sw.host, cmd);

        return { sw, map: parseInterfaceAddresses(output) };
      })
    );
    // 2. Merge all switch maps into one central addressMap
    for (const result of switchResults) {
      if (result.status === "fulfilled") {
        for (const [key, val] of result.value.map.entries()) {
          if (!addressMap.has(key)) addressMap.set(key, val);
        }
      } else {
        console.error(
          `[DIA Updater] ❌ Error fetching addresses from switch:`,
          result.reason.message
        );
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
        console.log(`[DIA Updater] ⚠️ No address found for ${rec.interface}`);
      }
    }

    // 4. Perform bulk update
    if (updates.length > 0) {
      await diacustomer.bulkCreate(
        updates.map((rec) => ({
          id: rec.id,
          interface: rec.interface,
          destination: rec.destination,
        })),
        {
          updateOnDuplicate: ["destination"],
        }
      );

      console.log(
        `[DIA Updater] ✅ Updated ${updates.length} records with interface IP addresses.`
      );
    } else {
      console.log(`[DIA Updater] ℹ️ No new interface IP addresses to update.`);
    }
  };

  const fetchInterfaceCid = async () => {
    const needDest = await customerinfo.findAll({
      where: { cid: { [Op.is]: null } },
    });

    console.log(`[DIA updater] ${needDest.length} need circuit id lookup.`);

    const allDevices = [...switches, ...pe];
    const cidMap = new Map();

    // 1. Fetch cid data concurrently for all devices

    const switchResults = await Promise.allSettled(
      allDevices.map(async (sw) => {
        console.log(
          `[DIA Updater] Fetching cid from ${sw.name} (${sw.host})...`
        );

        //🎯 The new command you requested
        const cmd = `show configuration |display set |match ps |match circuit-id`;
        const output = await runCommand(sw.host, cmd);

        return { sw, map: parseInterfaceCid(output) };
      })
    );

    // 2. Merge all switch mpas into one central addressMap
    for (const result of switchResults) {
      if (result.status === "fulfilled") {
        for (const [key, val] of result.value.map.entries()) {
          if (!cidMap.has(key)) cidMap.set(key, val);
        }
      } else {
        console.error(
          `[DIA Updater] ❌ Error fetching addresses from switch:`,
          result.reason.message
        );
      }
    }
    console.log(`[DIA Updater] Merged address map size: ${cidMap.size}`);

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
        console.log(`[DIA Updater] ⚠️ No ciruit id found for ${rec.interface}`);
      }
    }

    // 4. Perfrom bulk update
    if (updates.length > 0) {
      await customerinfo.bulkCreate(
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
        }
      );
      console.log(
        `[DIA Updater] ✅ Updated ${updates.length} records with interface circuit id.`
      );
    } else {
      console.log(`DIA Updater] ℹ️ No new interface circuit id to update.`);
    }
  };

  // === MAIN UPDATER FUNCTION ===
  const updateDIA = async () => {
    console.log(`\n[DIA Updater] Started at ${new Date().toISOString()}`);
    try {
      // === Step 1: Pull interface descriptions ===
      const bngResults = await Promise.all(
        switches.map(async (sw) => {
          console.log(`[DIA Updater] Fetching from ${sw.name}...`);
          const descOutput = await runCommand(
            sw.host,
            "show interfaces descriptions"
          );
          const parsed = parseInterfaces(descOutput, sw.name);
          console.log(
            `[DIA Updater] ${sw.name} returned ${parsed.length} interfaces`
          );
          return parsed;
        })
      );

      const peResults = await Promise.all(
        pe.map(async (p) => {
          console.log(`[DIA Updater] Fetching from PE ${p.name}...`);
          const cmd =
            "show interfaces descriptions | match DIA | except down | except mgmt";
          const descOutput = await runCommand(p.host, cmd);
          const parsed = parseInterfaces(descOutput, p.name);
          console.log(
            `[DIA Updater] PE ${p.name} returned ${parsed.length} interfaces`
          );
          return parsed;
        })
      );
      let allInterfaces = [...bngResults.flat(), ...peResults.flat()];
      // === Deduplicate by interface (prefer operational up) ===
      const seen = new Map();
      for (const intf of allInterfaces) {
        const key = `${intf.interface}`;
        const existing = seen.get(key);
        const isFromPE = pe.some((p) => p.name === intf.switchName);

        if (!existing) {
          // If interface is not seen, add it
          seen.set(key, intf);
        } else {
          // If already seen, check for preference
          const existingIsFromPE = pe.some(
            (p) => p.name === existing.switchName
          );

          if (isFromPE && !existingIsFromPE) {
            // New interface is from PE, existing is from BNG. Prefer PE.
            seen.set(key, intf);
          } else if (
            intf.operationalStatus === "up" &&
            existing.operationalStatus === "down"
          ) {
            // If both are from the same type (BNG/PE) or we're not dealing with a PE, prefer 'up' status.
            seen.set(key, intf);
          }
        }
      }
      allInterfaces = Array.from(seen.values());

      // === NOTIFICATION LOGIC ===
      console.log(
        "[DIA Updater] Checking for status changes for notifications..."
      );
      const previousStates = await diacustomer.findAll({
        attributes: ["interface", "operationalStatus"],
      });
      const previousStateMap = new Map(
        previousStates.map((item) => [item.interface, item.operationalStatus])
      );

      for (const currentInterface of allInterfaces) {
        const previousStatus = previousStateMap.get(currentInterface.interface);
        const currentStatus = currentInterface.operationalStatus;
        if (previousStatus === "up" && currentStatus === "down") {
          console.log(
            `[DIA Updater] STATUS CHANGE DETECTED: ${currentInterface.interface} went from UP to DOWN.`
          );
          await sendDownNotification(currentInterface); // This now emits the socket event
        }
      }
      // === END OF NOTIFICATION LOGIC ===

      // === STATUS CHANGE TRACKING ===
      console.log("[DIA Updater] Tracking status changes...");
      const customerInfoMap = await getDiaCustomerInfoMap();
      await trackStatusChanges(allInterfaces, "DIA", customerInfoMap);
      // === END STATUS CHANGE TRACKING ===

      // === Step 2: Bulk upsert diacustomers ===
      await diacustomer.bulkCreate(allInterfaces, {
        updateOnDuplicate: [
          "adminStatus",
          "operationalStatus",
          "description",
          "switchName",
        ],
      });
      console.log("[DIA Updater] Bulk insert/update done for diacustomers.");
      // === Step 3: Upsert customerinfo ===
      await upsertCustomerInfo(allInterfaces);
      // === Step 4: Fetch destinations ===
      await fetchInterfaceAddresses();
      // === Step 5: Fetch Circuit id ====
      await fetchInterfaceCid();
      // === Step 6: Update bandwidths via policers ===
      await updateBandwidths();
    } catch (err) {
      console.error("[DIA Updater] Fatal error:", err.message);
    }
    console.log("[DIA Updater] Finished run.\n");
  };

  const updateAggDevices = async () => {
    console.log(`[AGG Updater] Started at ${new Date().toISOString()}`);

    try {
      // 1. fetch NBRs missing in devices
      const missingNbrs = await customerinfo.findAll({
        attributes: [
          [db.Sequelize.fn("DISTINCT", db.Sequelize.col("nbr")), "nbr"],
        ],
        where: literal(`
        nbr IS NOT NULL
        AND TRIM(nbr) <> ''
        AND LOWER(nbr) NOT IN (
          SELECT LOWER(name) FROM devices WHERE name IS NOT NULL AND TRIM(name) <> ''
        )
      `),
        raw: true,
      });

      if (missingNbrs.length === 0) {
        console.log("[AGG Updater] No missing NBRs found.");
        return;
      }

      console.log(`[AGG Updater] Found ${missingNbrs.length} missing NBRs.`);

      for (const { nbr } of missingNbrs) {
        const interfaces = await customerinfo.findAll({
          attributes: ["id", "interface"],
          where: { nbr },
          raw: true,
        });

        for (const { id, interface: intf } of interfaces) {
          if (!intf) continue;

          const base = intf.split(".")[0];
          const shortIntf = `${base}.0`;

          console.log(
            `[AGG Updater] Trying BNG interfaces for ${nbr}, interface: ${shortIntf}`
          );
          for (const bng of switches) {
            try {
              // Run on BNG
              const neighOut = await runCommand(
                bng.host,
                `show l2circuit connections interface ${shortIntf} | match Neighbor`
              );
              const neighRegex = /Neighbor:\s+(\d{1,3}(?:\.\d{1,3}){3})/i;
              const neighMatch = neighOut.match(neighRegex);

              if (!neighMatch) continue;

              const ip = neighMatch[1];
              console.log(
                `[AGG Updater] Found neighbor ${ip} on ${bng.name} for ${nbr}`
              );
              if (nbr === "LTZ-ACC1-DAR") {
                // i want to not enter in the agg loop if the nbr is ltz-acc1-dar
                console.log(`[AGG Updater] Skipping AGG lookup for ${nbr}`);
                break;
              }
              // Run on AGG
              for (const sw of agg) {
                console.log(ip, sw.host, sw.name);

                const descOut = await runCommand(
                  sw.host,
                  `show configuration | display set | match ${ip}`
                );

                const descRegex = new RegExp(
                  `neighbor\\s+${ip}\\s+description\\s+(?:"([^"]+)"|(\\S+))`,
                  "i"
                );

                const descMatch = descOut.match(descRegex);

                let finalDescription;

                if (descMatch && (descMatch[1] || descMatch[2])) {
                  const capturedText = descMatch[1]
                    ? descMatch[1].trim()
                    : descMatch[2].trim(); // Remove all leading/trailing whitespace

                  // Check if the captured text contains a space
                  if (capturedText.includes(" ")) {
                    // If it does, take everything before the first space
                    // To remove the final hyphen, you can add another step
                    finalDescription = capturedText.split(" ")[0].endsWith("-")
                      ? capturedText.split(" ")[0].slice(0, -1)
                      : capturedText.split(" ")[0];
                  } else {
                    // Otherwise, use the whole captured string
                    finalDescription = capturedText;
                  }
                }

                if (finalDescription) {
                  if (!finalDescription.includes('"')) {
                    const device = await Device.findOne({
                      where: { name: finalDescription },
                    });

                    if (!device) {
                      await Device.upsert(
                        { ip, name: finalDescription },
                        { fields: ["ip", "name"] }
                      );
                      await customerinfo.update(
                        { nbr: finalDescription },
                        { where: { id } }
                      );
                      console.log(
                        `[AGG Updater] Updated customerinfo id=${id} with nbr=${finalDescription}`
                      );
                    } else {
                      await customerinfo.update(
                        { nbr: finalDescription },
                        { where: { id } }
                      );
                    }
                  } else {
                    console.log(
                      `[AGG Updater] ⚠️ Skipping invalid name for ${nbr}: "${finalDescription}"`
                    );
                  }

                  // Found and processed, break out of AGG loop
                  break;
                }
              }
            } catch (error) {
              console.error(
                `[AGG Updater] Error on ${bng.name}:`,
                error.message
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("[AGG Updater] Fatal error:", error.message);
    }
  };

  const runAll = async () => {
    try {
      await updateDIA(); // ✅ Run first
      await updateAggDevices(); // ✅ Run second
    } catch (err) {
      console.error("[Main Runner] Fatal error:", err.message);
    }
  };
  cron.schedule("0 * * * *", runAll);
  // Run immediately for testing
  // runAll();
  return {
    updateDIA,
    updateAggDevices,
  };
};