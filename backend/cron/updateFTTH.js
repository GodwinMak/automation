const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const { parse } = require("path");
const { trackStatusChanges } = require("../utils/statusTracker");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
  };

  const bng = [
    { name: "LTZ-BNG01-RAH-DAR", host: "41.175.37.14" }
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

  const parseInterfaces = (output) => {
    const results = [];
    const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      let username = null;
      let ipRaw = null;

      for (const part of parts) {
        if (part.includes("@") && part.toLowerCase().includes("liquidtelecom.com")) {
          username = part;
        } else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(part)) {
          // IPv4 — always preferred, overrides any IPv6 already found
          ipRaw = part;
        } else if (!ipRaw && /^[0-9a-f:]+\/\d+$/i.test(part) && part.includes(":")) {
          // IPv6 with prefix — only use if no IPv4 found yet
          ipRaw = part;
        }
      }

      if (!username || !ipRaw) continue;

      const ip = ipRaw.includes("/") ? ipRaw.split("/")[0] : ipRaw;
      const ip_version = ip.includes(":") ? "IPv6" : "IPv4";

      results.push({ ip, pppoeusername: username, ip_version });
    }

    return results;
  };

  const updateFTTHData = async () => {
    const ftthcustomer = db.ftthcustomers;

    try {
      const bngResults = await Promise.all(
        bng.map(async (device) => {
          const output = await runCommand(
            device.host,
            "show subscribers | match liquidtelecom"
          );
          return parseInterfaces(output);
        })
      );

      // Merge all results from all BNGs, deduplicate by IP first
      const seenIps = new Set();
      const rawRecords = [];
      for (const records of bngResults) {
        for (const r of records) {
          if (!seenIps.has(r.ip)) {
            seenIps.add(r.ip);
            rawRecords.push(r);
          }
        }
      }

      // Deduplicate by pppoeusername — prefer IPv4 over IPv6
      const byUsername = new Map();
      for (const r of rawRecords) {
        const existing = byUsername.get(r.pppoeusername);
        if (!existing) {
          byUsername.set(r.pppoeusername, r);
        } else if (r.ip_version === "IPv4" && existing.ip_version !== "IPv4") {
          // Replace IPv6 entry with IPv4
          byUsername.set(r.pppoeusername, r);
        }
      }
      const allRecords = Array.from(byUsername.values());

      if (allRecords.length === 0) {
        console.warn("[FTTH] BNG returned 0 subscribers — skipping update to avoid false downs (possible SSH/parse issue).");
        return;
      }

      // Upsert seen records as "up"
      // updateOnDuplicate on pppoeusername unique key → update ip/version/status in place
      // (handles IPv6→IPv4 switch where same username gets a new IP)
      const upRecords = allRecords.map((r) => ({ ...r, status: "up" }));
      await ftthcustomer.bulkCreate(upRecords, {
        updateOnDuplicate: ["ip", "ip_version", "status"],
      });

      console.log(`[FTTH] Upserted ${allRecords.length} subscriber(s) as up.`);

      // Mark as "down" any username NOT currently seen on BNG.
      // Using pppoeusername (not IP) so that IP reassignment between subscribers
      // doesn't leave stale "up" records for disconnected users.
      const activeUsernames = allRecords.map((r) => r.pppoeusername);
      const [downCount] = await ftthcustomer.update(
        { status: "down" },
        { where: { pppoeusername: { [Op.notIn]: activeUsernames } } }
      );

      if (downCount > 0) {
        console.log(`[FTTH] Marked ${downCount} subscriber(s) as down.`);
      }

      // Track status changes for churn analysis
      const allFtthCustomers = await ftthcustomer.findAll({
        attributes: ["ip", "pppoeusername", "customerID", "customerName", "homeNumber", "status"],
        raw: true,
      });
      const ftthInfoMap = Object.fromEntries(
        allFtthCustomers.map((r) => [
          r.ip,
          { customerName: r.customerName || r.pppoeusername, cid: r.customerID || null, nbr: r.homeNumber || null },
        ])
      );
      await trackStatusChanges(
        allFtthCustomers.map((r) => ({ interface: r.ip, operationalStatus: r.status, switchName: null })),
        "FTTH",
        ftthInfoMap
      );

    } catch (error) {
      console.error("[FTTH] Error updating FTTH data:", error);
    }
  };

  const runAll = async () => {
      try {
        await updateFTTHData(); // ✅ Run first
      } catch (err) {
        console.error("[Main Runner] Fatal error:", err.message);
      }
    };
    cron.schedule("*/5 * * * *", runAll);

    return {  
    updateFTTHData,
  };
};
