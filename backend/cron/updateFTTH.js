const cron = require("node-cron");
const { Client } = require("ssh2");
const db = require("../Models");
const { Op, literal } = require("sequelize");
const { parse } = require("path");
const { trackStatusChanges } = require("../utils/statusTracker");
const { enqueueBatch } = require("../utils/warehouseSpool");
const { withLock } = require("../utils/cronLock");

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
      await withLock("ftth_cron_update", async () => {
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

      const ftthRecords = await ftthcustomer.findAll({
        attributes: [
          "ip",
          "pppoeusername",
          "ip_version",
          "status",
          "customerID",
          "customerName",
          "homeNumber",
          "topUpExpiry",
          "isExpired",
          "isAliveWhileExpired",
          "isFreeCustomer",
        ],
        raw: true,
      });
      const ftthInfoRecords = await db.ftthcustomerinfos.findAll({
        attributes: ["customerID", "emailAddress", "validityPeriod"],
        raw: true,
      });
      const infoByCustomerID = new Map(
        ftthInfoRecords.map((i) => [i.customerID, i]),
      );
      const mergedRecords = ftthRecords.map((f) => {
        const info = infoByCustomerID.get(f.customerID) || {};
        return {
          record_key: f.customerID || f.pppoeusername || f.ip,
          cid: null,
          poll_ts: new Date(),
          payload: {
            ip: f.ip,
            pppoeusername: f.pppoeusername,
            ip_version: f.ip_version,
            status: f.status,
            customerID: f.customerID,
            customerName: f.customerName,
            homeNumber: f.homeNumber,
            topUpExpiry: f.topUpExpiry,
            isExpired: f.isExpired,
            isAliveWhileExpired: f.isAliveWhileExpired,
            isFreeCustomer: f.isFreeCustomer,
            emailAddress: info.emailAddress || null,
            validityPeriod: info.validityPeriod || null,
          },
        };
      });
      enqueueBatch("FTTH", mergedRecords);

      // 3. Track status changes using the full current snapshot, not just this
      // tick's delta — trackStatusChanges' cache is unseeded per-process, so
      // feeding it only transitions let a customer's first-ever down event
      // after a worker restart go unlogged (cache read back as "unknown").
      // Passing every customer every tick, as updateIPT.js/updateDIA.js do,
      // makes the cache self-heal within a single cycle.
      //
      // pppoeusername (not ip) is the stable identity for FTTH tracking —
      // a subscriber's IP can change between sessions, but their PPPoE
      // login is fixed. Customers without one can't be reliably tracked.
      const trackableFtthCustomers = ftthRecords.filter((r) => r.pppoeusername);
      const skippedCount = ftthRecords.length - trackableFtthCustomers.length;
      if (skippedCount > 0) {
        console.warn(`[FTTH] Skipping status tracking for ${skippedCount} customer(s) with no pppoeusername`);
      }

      if (trackableFtthCustomers.length > 0) {
        const ftthInfoMap = Object.fromEntries(
          trackableFtthCustomers.map((r) => [
            r.pppoeusername,
            { customerName: r.customerName || r.pppoeusername, cid: r.customerID || null, nbr: r.homeNumber || null },
          ])
        );
        await trackStatusChanges(
          trackableFtthCustomers.map((r) => ({ interface: r.pppoeusername, operationalStatus: r.status, switchName: null })),
          "FTTH",
          ftthInfoMap
        );
      }

      } catch (error) {
        console.error("[FTTH] Error updating FTTH data:", error);
      }
      });
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
