const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const { trackStatusChanges, getIptCustomerInfoMap } = require("../utils/statusTracker");

require("dotenv").config({ path: "../.env" });

module.exports = (io) => {
  const sshConfig = {
    username: "godwin.makyao",
    password: "Namwel200148#@!",
  };

  const Device = db.devices;
  const iptcustomers = db.iptcustomers;
  const iptcustomerinfos = db.iptcustomerinfos;

  const pe = [
    { name: "LTZ-PE1-RAH", host: "197.155.94.100" },
    { name: "LTZ-PE1-TIG", host: "197.155.94.138" },
  ];

  const p = [{ name: "LTZ-P1-DAR", host: "197.155.94.114" }];

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

  const parseCustomerInfo = (intf) => {
    const desc = intf.description || "";

    const info = {
      interface: intf.interface,
      nbr: "",
      port: "",
      customerName: "",
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
      await iptcustomerinfos.bulkCreate(customerRecords, {
        updateOnDuplicate: ["nbr", "port", "customerName"],
      });

      console.log(
        `[CustomerInfo] Upsert done. Processed ${customerRecords.length} records.`
      );
    }
  };

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
      const allDevices = [...pe, ...p];
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

      const infos = await iptcustomerinfos.findAll();

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
        await iptcustomerinfos.bulkCreate(updates, {
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

    const regex =
      /^set interfaces (\S+) unit (\d+) family inet address (\d{1,3}(?:\.\d{1,3}){3}\/\d+)$/i;

    for (const line of lines) {
      const match = line.match(regex);

      if (match) {
        let [, ifName, unit, cidr] = match;

        if (unit === "1") {
          // ✔ Save psXXXX.1
          map.set(`${ifName}.1`, cidr);

          // ✔ Also save psXXXX.0
          map.set(`${ifName}.0`, cidr);
        } else {
          // Normal behavior
          const key = `${ifName}.${unit}`;
          map.set(key, cidr);
        }
      }
    }

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
    const needDest = await iptcustomers.findAll({
      where: { destination: { [Op.is]: null } },
    });
    console.log(`[DIA Updater] ${needDest.length} need destination lookup.`);

    const allDevices = [...pe, ...p];
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
      await iptcustomers.bulkCreate(
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
    const needDest = await iptcustomerinfos.findAll({
      where: { cid: { [Op.is]: null } },
    });

    console.log(`[DIA updater] ${needDest.length} need circuit id lookup.`);

    const allDevices = [...pe, ...p];
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
      await iptcustomerinfos.bulkCreate(
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

  const getPeerIP = (destination) => {
    if (!destination) return null;

    const [ip] = destination.split("/");

    const octets = ip.split(".").map(Number);
    octets[3] += 1; // next usable after gateway

    // handle overflow (e.g., 255 → next octet)
    for (let i = 3; i >= 0; i--) {
      if (octets[i] > 255) {
        octets[i] = 0;
        if (i > 0) octets[i - 1] += 1;
      }
    }

    return octets.join(".");
  };

  const parseASN = (output) => {
    if (!output) return null;

    // Example:
    // set protocols bgp group X neighbor 154.72.85.158 peer-as 327885
    const match = output.match(/peer-as\s+(\d+)/i);

    if (!match) return null;

    return "AS" + match[1];
  };

  const fetchInterfaceASN = async () => {
    const needASN = await iptcustomerinfos.findAll({
      where: { asn: { [Op.is]: null } },
      include: [
        {
          model: db.iptcustomers,
          attributes: ["destination"],
        },
      ],
    });

    console.log(`[ASN Updater] ${needASN.length} need ASN lookup.`);

    const allDevices = [...pe, ...p];
    const updates = [];

    // Loop through every record that needs ASN
    for (const rec of needASN) {
      const dest = rec.iptcustomer?.destination;
      if (!dest) {
        console.log(
          `[ASN Updater] ⚠️ No destination found for ${rec.interface}`
        );
        continue;
      }

      // Compute peer IP
      const ipToCheck = getPeerIP(dest);
      console.log(
        `[ASN Updater] Looking up ASN for ${rec.interface} using ${ipToCheck}`
      );

      const cmd = `show configuration | display set | match ${ipToCheck} | match peer-as`;

      let foundASN = null;

      // Try each device — STOP immediately if found
      for (const sw of allDevices) {
        try {
          const output = await runCommand(sw.host, cmd);
          const asn = parseASN(output);

          if (asn) {
            foundASN = asn;
            console.log(
              `[ASN Updater] ${rec.interface} → ${asn} (from ${sw.host})`
            );
            break; // ⛔ STOP querying devices for this record
          }
        } catch (err) {
          console.log(`[ASN Updater] Error querying ${sw.host}:`, err.message);
        }
      }

      // If we got the ASN → update list
      if (foundASN) {
        rec.asn = foundASN;
        updates.push(rec);
        continue; // 🔁 Move to the NEXT needASN record immediately
      }

      console.log(`[ASN Updater] ⚠️ No ASN found for ${rec.interface}`);
    }

    // Apply all updates
    if (updates.length > 0) {
      await iptcustomerinfos.bulkCreate(
        updates.map((rec) => ({
          id: rec.id,
          interface: rec.interface,
          port: rec.port,
          nbr: rec.nbr,
          customerName: rec.customerName,
          asn: rec.asn,
        })),
        { updateOnDuplicate: ["asn"] }
      );

      console.log(
        `[ASN Updater] ✅ Updated ${updates.length} records with ASN.`
      );
    } else {
      console.log(`[ASN Updater] ℹ️ No new ASN to update.`);
    }
  };

  // === MAIN UPDATER FUNCTION ===
  const updateIPT = async () => {
    console.log(`\n[IPT Updater] Started at ${new Date().toISOString()}`);

    try {
      // === Step 1: Pull interface descriptions ===
      const peResults = await Promise.all(
        pe.map(async (sw) => {
          console.log(`[IPT Updater] Fetching from ${sw.name}...`);
          const descOutput = await runCommand(
            sw.host,
            `show interfaces descriptions | match cat | match IPT`
          );
          const parsed = parseInterfaces(descOutput, sw.name);
          console.log(
            `[IPT Updater] ${sw.name} returned ${parsed.length} interfaces`
          );
          return parsed;
        })
      );

      const pResults = await Promise.all(
        p.map(async (p) => {
          console.log(`[DIA Updater] Fetching from PE ${p.name}...`);
          const cmd = `show interfaces descriptions |match cat | match IPT`;
          const descOutput = await runCommand(p.host, cmd);
          const parsed = parseInterfaces(descOutput, p.name);
          console.log(
            `[IPT Updater] PE ${p.name} returned ${parsed.length} interfaces`
          );
          return parsed;
        })
      );

      let allInterfaces = [...peResults.flat(), ...pResults.flat()];

      console.log(allInterfaces);

      // ===Deduplicate by interface (prefer operational up)===
      const seen = new Map();
      for (const intf of allInterfaces) {
        const key = `${intf.interface}`;
        const existing = seen.get(key);
        const isFromP = p.some((p) => p.name === intf.switchName);

        if (!existing) {
          // If interface is not seen, add it
          seen.set(key, intf);
        } else {
          // If already seen, check for preference
          const existingIsFromP = pe.some(
            (p) => p.name === existing.switchName
          );

          if (isFromP && !existingIsFromP) {
            // New interface is from P, existing is from PE. Prefer P.
            seen.set(key, intf);
          } else if (
            intf.operationalStatus === "up" &&
            existing.operationalStatus === "down"
          ) {
            // If both are from the same type (P/PE) or we're not dealing with a PE, prefer 'up' status.
            seen.set(key, intf);
          }
        }
      }
      allInterfaces = Array.from(seen.values());

      // === STATUS CHANGE TRACKING ===
      console.log("[IPT Updater] Tracking status changes...");
      const customerInfoMap = await getIptCustomerInfoMap();
      await trackStatusChanges(allInterfaces, "IPT", customerInfoMap);
      // === END STATUS CHANGE TRACKING ===

      // === Step 2: Bulk upsert iptcustomers ===
      await iptcustomers.bulkCreate(allInterfaces, {
        updateOnDuplicate: [
          "adminStatus",
          "operationalStatus",
          "description",
          "switchName",
        ],
      });

      console.log("[DIA Updater] Bulk insert/update done for iptcustomers.");
      // === Step 3: Upsert customerinfo ===
      await upsertCustomerInfo(allInterfaces);
      // === Step 4: Fetch destinations ===
      await fetchInterfaceAddresses();
      //   // === Step 5: Fetch Circuit id ====
      await fetchInterfaceCid();
      //   // === Step 6: Fetch Circuit id ====
      await fetchInterfaceASN();
      //   // === Step 7: Update bandwidths via policers ===
      await updateBandwidths();
    } catch (err) {
      console.error("[IPT Updater] Fatal error:", err.message);
    }
    console.log("[IPT Updater] Finished run.\n");
  };

  const updateAggDevicesIPT = async () => {
    console.log(`[AGG Updater] Started at ${new Date().toISOString()}`);

    try {
      // 1. fetch NBRs missing in devices
      const missingNbrs = await iptcustomerinfos.findAll({
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
        const interfaces = await iptcustomerinfos.findAll({
          attributes: ["id", "interface"],
          where: { nbr },
          raw: true,
        });

        for (const { id, interface: intf } of interfaces) {
          if (!intf) continue;

          const base = intf.split(".")[0];
          const shortIntf = `${base}.0`;

          console.log(
            `[AGG Updater] Trying PE interfaces for ${nbr}, interface: ${shortIntf}`
          );

          for (const r of pe) {
            try {
              const neighOut = await runCommand(
                r.host,
                `show l2circuit connections interface ${shortIntf} | match Neighbor`
              );
              const neighRegex = /Neighbor:\s+(\d{1,3}(?:\.\d{1,3}){3})/i;
              const neighMatch = neighOut.match(neighRegex);

              if (!neighMatch) continue;

              const ip = neighMatch[1];
              console.log(
                `[AGG Updater] Found neighbor ${ip} on ${r.name} for ${nbr}`
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
                      await iptcustomerinfos.update(
                        { nbr: finalDescription },
                        { where: { id } }
                      );
                      console.log(
                        `[AGG Updater] Updated customerinfo id=${id} with nbr=${finalDescription}`
                      );
                    } else {
                      await iptcustomerinfos.update(
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
              console.error(`[AGG Updater] Error on ${r.name}:`, error.message);
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
      await updateIPT(); // ✅ Run first
      await updateAggDevicesIPT();// ✅ Run second
    } catch (err) {
      console.error("[Main Runner] Fatal error:", err.message);
    }
  };
  cron.schedule("*/5 * * * *", runAll);
  // Run immediately for testing
  // runAll();

  return {
    updateIPT,
    updateAggDevicesIPT,
  };
};
