const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const { parse } = require("path");
const { trackStatusChanges } = require("../utils/statusTracker");

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

module.exports = (io, options = {}) => {
  const sshConfig = {
    username: process.env.SSH_USERNAME,
    password: process.env.SSH_PASSWORD,
    readyTimeout: 15000,      // fail fast if BNG is unreachable
    keepaliveInterval: 10000, // detect dead sockets
    keepaliveCountMax: 2,
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

  let isRunning = false;
  const updateFTTHData = async () => {
    if (isRunning) {
      console.warn("[FTTH] Sync already in progress — skipping this tick.");
      return;
    }
    isRunning = true;
    const ftthcustomer = db.ftthcustomers;

    try {
      // Distributed lock across all PM2 instances via MySQL advisory lock.
      // GET_LOCK('name', 0) returns 1 if acquired, 0 if another connection holds it.
      const [[{ acquired }]] = await db.sequelize.query(
        "SELECT GET_LOCK('ftth_cron_update', 0) AS acquired"
      );
      if (!acquired) {
        if (process.env.LOG_LOCK_SKIPS === "1") {
          console.warn("[FTTH] Another instance is already running — skipping this tick.");
        }
        isRunning = false;
        return;
      }

    const runStart = new Date();
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

      const activeIps = allRecords.map((r) => r.ip);

      // 1. Fetch only transitioning customers before executing updates to avoid massive full-table loads
      const transitioningToUp = await ftthcustomer.findAll({
        where: {
          ip: activeIps,
          status: "down",
        },
        attributes: ["ip", "pppoeusername", "customerID", "customerName", "homeNumber"],
        raw: true,
      });

      const transitioningToDown = await ftthcustomer.findAll({
        where: {
          ip: { [Op.notIn]: activeIps },
          status: "up",
        },
        attributes: ["ip", "pppoeusername", "customerID", "customerName", "homeNumber"],
        raw: true,
      });

      // 2. Perform database updates
      // Upsert seen records as "up"
      // updateOnDuplicate on pppoeusername unique key → update ip/version/status in place
      const upRecords = allRecords.map((r) => ({ ...r, status: "up" }));
      await ftthcustomer.bulkCreate(upRecords, {
        updateOnDuplicate: ["ip", "ip_version", "status", "updatedAt"],
      });

      console.log(`[FTTH] Upserted ${allRecords.length} subscriber(s) as up.`);

      // Mark as "down" any record not touched in this run.
      const [downCount] = await ftthcustomer.update(
        { status: "down" },
        { where: { updatedAt: { [Op.lt]: runStart } } }
      );

      if (downCount > 0) {
        console.log(`[FTTH] Marked ${downCount} subscriber(s) as down.`);
      }

      // 3. Track status changes using only the transitioned subset (highly memory efficient)
      const changedFtthCustomers = [
        ...transitioningToUp.map(r => ({ ...r, status: "up" })),
        ...transitioningToDown.map(r => ({ ...r, status: "down" }))
      ];

      if (changedFtthCustomers.length > 0) {
        const ftthInfoMap = Object.fromEntries(
          changedFtthCustomers.map((r) => [
            r.ip,
            { customerName: r.customerName || r.pppoeusername, cid: r.customerID || null, nbr: r.homeNumber || null },
          ])
        );
        await trackStatusChanges(
          changedFtthCustomers.map((r) => ({ interface: r.ip, operationalStatus: r.status, switchName: null })),
          "FTTH",
          ftthInfoMap
        );
      }

      } catch (error) {
        console.error("[FTTH] Error updating FTTH data:", error);
      } finally {
        await db.sequelize.query("SELECT RELEASE_LOCK('ftth_cron_update')");
      }
    } catch (outerError) {
      console.error("[FTTH] Outer Error:", outerError.message);
    } finally {
      isRunning = false;
    }
  };

  const runAll = async () => {
      try {
        await updateFTTHData(); // ✅ Run first
      } catch (err) {
        console.error("[Main Runner] Fatal error:", err.message);
      }
    };
    if (options.schedule !== false) {
      cron.schedule("4,9,14,19,24,29,34,39,44,49,54,59 * * * *", runAll);
      console.log("[FTTH] Sync cron job scheduled with 4-minute offset to prevent BNG CPU and DB collisions.");
    }

    return {  
    updateFTTHData,
  };
};
