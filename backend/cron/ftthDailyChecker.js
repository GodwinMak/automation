/**
 * FTTH Daily Checker Cron
 *
 * Runs once per day at 06:00.
 * 1. Pings all expired FTTH customers (isExpired=true, isFreeCustomer=false).
 *    - If alive → sets isAliveWhileExpired=true and notifies customer_relation.
 * 2. Finds ftthcustomer records with no matching ftthcustomerinfo row (notInInfo=true)
 *    and re-notifies customer_relation (in case they missed it during upload).
 * 3. Generates a daily Excel report with findings, saves it to backend/reports/ftth/.
 *    Reports older than 90 days are automatically deleted (file + DB record).
 */
const cron = require("node-cron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const db = require("../Models");

const REPORTS_DIR = path.join(__dirname, "../reports/ftth");

const pingHost = (ip) =>
  new Promise((resolve) => {
    exec(`ping -c 1 -W 3 ${ip}`, (error) => resolve(!error));
  });

/** Generate and save the daily Excel report, then persist metadata to DB.
 *  Called on every hourly run. Reads any existing file for today and merges
 *  `newAliveRecords` into it so the "Times Found Alive Today" column accumulates
 *  across all 24 runs without requiring any DB schema changes.
 */
const saveReport = async ({ reportDate, totalExpiredChecked, newAliveRecords, notInInfoRecords }) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const fileName = `FTTH_Report_${reportDate}.xlsx`;
    const filePath = path.join(REPORTS_DIR, fileName);

    // --- Merge new findings into accumulated alive map from existing file ---
    // Key: pppoeusername (or ip as fallback) → accumulated record + hit count
    const accumulatedAlive = new Map();
    let checksRunToday = 0;

    if (fs.existsSync(filePath)) {
      try {
        const existing = XLSX.readFile(filePath);

        // Read run count from Summary sheet
        const summarySheet = existing.Sheets["Summary"];
        if (summarySheet) {
          const summaryRows = XLSX.utils.sheet_to_json(summarySheet);
          const runRow = summaryRows.find((r) => r["Field"] === "Hourly Checks Run Today");
          if (runRow) checksRunToday = Number(runRow["Value"]) || 0;
        }

        // Read per-customer hits from Alive While Expired sheet
        const aliveSheet = existing.Sheets["Alive While Expired"];
        if (aliveSheet) {
          const rows = XLSX.utils.sheet_to_json(aliveSheet);
          for (const row of rows) {
            const key = row["PPPoE Username"] || row["IP Address"];
            if (!key) continue;
            accumulatedAlive.set(key, {
              customerID: row["Customer ID"] || "",
              customerName: row["Customer Name"] || "",
              pppoeusername: row["PPPoE Username"] || "",
              ip: row["IP Address"] || "",
              topUpExpiry: row["Top-Up Expiry"] || "",
              hits: Number(row["Times Found Alive Today"]) || 0,
            });
          }
        }
      } catch (e) {
        console.warn("[FTTH Checker] Could not read existing report for merge:", e.message);
      }
    }

    checksRunToday += 1;

    // Merge this run's alive records (increment hits per customer)
    for (const r of newAliveRecords) {
      const key = r.pppoeusername || r.ip;
      if (!key) continue;
      if (accumulatedAlive.has(key)) {
        accumulatedAlive.get(key).hits += 1;
      } else {
        accumulatedAlive.set(key, {
          customerID: r.customerID || "",
          customerName: r.customerName || "",
          pppoeusername: r.pppoeusername || "",
          ip: r.ip || "",
          topUpExpiry: r.topUpExpiry ? new Date(r.topUpExpiry).toISOString().split("T")[0] : "",
          hits: 1,
        });
      }
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1 – Summary
    const summaryData = [
      { Field: "Report Date", Value: reportDate },
      { Field: "Hourly Checks Run Today", Value: checksRunToday },
      { Field: "Total Expired (Up) Customers Pinged (Latest)", Value: totalExpiredChecked },
      { Field: "Alive While Expired (Unique)", Value: accumulatedAlive.size },
      { Field: "Not in Churn Report", Value: notInInfoRecords.length },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), "Summary");

    // Sheet 2 – Alive While Expired (cumulative across all hourly runs)
    const aliveSheetData = accumulatedAlive.size > 0
      ? Array.from(accumulatedAlive.values()).map((r) => ({
          "Customer ID": r.customerID,
          "Customer Name": r.customerName,
          "PPPoE Username": r.pppoeusername,
          "IP Address": r.ip,
          "Top-Up Expiry": r.topUpExpiry,
          "Times Found Alive Today": r.hits,
        }))
      : [{ Note: "No customers alive while expired today." }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aliveSheetData), "Alive While Expired");

    // Sheet 3 – Not in Churn Report
    const notInInfoSheet = notInInfoRecords.length
      ? notInInfoRecords.map((r) => ({
          "Customer ID": r.customerID || "",
          "Customer Name": r.customerName || "",
          "PPPoE Username": r.pppoeusername || "",
          "IP Address": r.ip || "",
        }))
      : [{ Note: "All customers present in churn report." }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notInInfoSheet), "Not In Churn Report");

    XLSX.writeFile(wb, filePath);

    // Upsert the DB record (one report per date) — counts reflect latest/cumulative state
    const FTTHReport = db.ftthReports;
    const [report] = await FTTHReport.upsert({
      reportDate,
      filePath,
      totalExpiredChecked,
      aliveWhileExpiredCount: accumulatedAlive.size,
      notInInfoCount: notInInfoRecords.length,
    });

    console.log(`[FTTH Checker] Report updated → ${fileName} (run ${checksRunToday} today, ${accumulatedAlive.size} unique alive-while-expired)`);
    return report;
  } catch (err) {
    console.error("[FTTH Checker] Failed to save report:", err.message);
  }
};

/** Delete report files and DB records older than 90 days. */
const cleanupOldReports = async () => {
  try {
    const FTTHReport = db.ftthReports;
    const { Op } = db.Sequelize;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const old = await FTTHReport.findAll({ where: { reportDate: { [Op.lt]: cutoff } } });
    for (const r of old) {
      if (r.filePath && fs.existsSync(r.filePath)) fs.unlinkSync(r.filePath);
      await r.destroy();
    }
    if (old.length) console.log(`[FTTH Checker] Cleaned up ${old.length} report(s) older than 90 days.`);
  } catch (err) {
    console.error("[FTTH Checker] Cleanup error:", err.message);
  }
};

const runFTTHDailyCheck = async () => {
  console.log("[FTTH Checker] Starting daily check…");

  const FTTHCustomer = db.ftthcustomers;
  const FTTHCustomerInfo = db.ftthcustomerinfos;

  const reportDate = new Date().toISOString().split("T")[0];
  let totalExpiredChecked = 0;
  const newAliveRecords = [];
  let notInInfoRecords = [];

  // --- 1. Ping expired customers that are not free-service ---
  try {
    const { Op } = db.Sequelize;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const expiredCustomers = await FTTHCustomer.findAll({
      where: {
        isExpired: true,
        isFreeCustomer: false,
        status: "up", // only ping customers with an active BNG session
        topUpExpiry: { [Op.lt]: startOfToday }, // today's date is NOT expired
      },
    });

    totalExpiredChecked = expiredCustomers.length;
    console.log(`[FTTH Checker] ${totalExpiredChecked} expired customer(s) to ping.`);

    // Ping up to 15 customers concurrently to avoid long sequential wait
    const validCustomers = expiredCustomers.filter((c) => c.ip);
    for (let i = 0; i < validCustomers.length; i += 15) {
      const chunk = validCustomers.slice(i, i + 15);
      const pingResults = await Promise.all(
        chunk.map(async (customer) => {
          const isAlive = await pingHost(customer.ip);
          await customer.update({ lastPingedAt: new Date() });
          return { customer, isAlive };
        })
      );
      for (const { customer, isAlive } of pingResults) {
        if (isAlive) {
          await customer.update({ isAliveWhileExpired: true });
          newAliveRecords.push({
            customerID: customer.customerID,
            customerName: customer.customerName,
            pppoeusername: customer.pppoeusername,
            ip: customer.ip,
            topUpExpiry: customer.topUpExpiry,
          });
          console.log(`[FTTH Checker] ALIVE while expired: ${customer.customerName || customer.ip}`);
        }
      }
    }
  } catch (err) {
    console.error("[FTTH Checker] Ping check error:", err.message);
  }

  // --- 2. Re-notify for customers in ftthcustomer but not in ftthcustomerinfo ---
  try {
    const found = await FTTHCustomer.findAll({
      where: { notInInfo: true },
    });
    notInInfoRecords = found.map((c) => ({
      customerID: c.customerID,
      customerName: c.customerName,
      pppoeusername: c.pppoeusername,
      ip: c.ip,
    }));

    if (notInInfoRecords.length) {
      console.log(
        `[FTTH Checker] ${notInInfoRecords.length} customer(s) not in ftthcustomerinfo.`
      );
    }
  } catch (err) {
    console.error("[FTTH Checker] notInInfo check error:", err.message);
  }

  // --- 3. Save/update the daily Excel report & clean up old ones ---
  await saveReport({ reportDate, totalExpiredChecked, newAliveRecords, notInInfoRecords });
  await cleanupOldReports();

  console.log("[FTTH Checker] Daily check complete.");
};

const scheduleFTTHDailyCheck = () => {
  // Run every hour
  cron.schedule("0 * * * *", async () => {
    await runFTTHDailyCheck();
  });
  console.log("[FTTH Checker] Hourly cron scheduled.");
};

module.exports = { scheduleFTTHDailyCheck, runFTTHDailyCheck };
