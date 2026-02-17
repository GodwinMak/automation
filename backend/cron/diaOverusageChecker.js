const cron = require("node-cron");
const db = require("../Models");
const { getZabbixHistory } = require("../Controller/diagnosis");

// Format bits-per-second into a human-readable string
function formatBps(value) {
  const v = Number(value) || 0;
  if (v <= 0) return "0 bps";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} Gbps`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} Mbps`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)} Kbps`;
  return `${v.toFixed(2)} bps`;
}

/**
 * Check DIA customers for over-usage based on Zabbix graph data.
 * For each DIA customer, fetch the last 24 hours of traffic and
 * count how many samples exceed 130% of the configured upload/download Mbps.
 *
 * Threshold per direction (bps): capacity_mbps * 1e6 * 1.3
 */
const checkDiaOverusage = async () => {
    try {
      console.log("[DIA Overusage] Starting daily over-usage check (last 24h)...");

      const DiaCustomer = db.diacustomers;
      const CustomerInfo = db.customerinfos;

      const diaCustomers = await DiaCustomer.findAll({
        include: [
          {
            model: CustomerInfo,
          },
        ],
      });

        console.log(`[DIA Overusage] Found ${diaCustomers.length} DIA customers to evaluate.`);

        const DiaOverusageReport = db.diaOverusageReports;

        // Clear previous report data (full refresh on each run)
        await DiaOverusageReport.destroy({ where: {} });

        let customersWithOverusage = 0;
        const overusageResults = [];

      for (const customer of diaCustomers) {
        const infos = customer.customerinfos || [];
        const info = Array.isArray(infos) ? infos[0] : infos;

        if (!info) {
          continue;
        }

        const { upmbps, downmbps, customerName, cid, nbr, port } = info;

        if (!upmbps && !downmbps) {
          // No capacity configured, skip
          continue;
        }

        const interfaceName = customer.interface;
        const switchName = customer.switchName;

        if (!interfaceName || !switchName) {
          continue;
        }

        // Fetch last 24 hours of history from Zabbix
        const zabbixData = await getZabbixHistory(interfaceName, switchName, 24);

        if (!zabbixData || !zabbixData.sentData || !zabbixData.recvData) {
          continue;
        }

        const { sentData, recvData } = zabbixData;

        // Convert Mbps capacity to bps and apply 130% threshold
        const upCapacityBps = upmbps ? upmbps * 1e6 : 0;
        const downCapacityBps = downmbps ? downmbps * 1e6 : 0;

        const upThreshold = upCapacityBps > 0 ? upCapacityBps * 1.3 : 0;
        const downThreshold = downCapacityBps > 0 ? downCapacityBps * 1.3 : 0;

        let overUploadSamples = 0;
        let overDownloadSamples = 0;

        if (upThreshold > 0) {
          overUploadSamples = sentData.filter((d) => Number(d.value) >= upThreshold).length;
        }

        if (downThreshold > 0) {
          overDownloadSamples = recvData.filter((d) => Number(d.value) >= downThreshold).length;
        }

        if (overUploadSamples > 0 || overDownloadSamples > 0) {
          customersWithOverusage += 1;

          // Maximum values observed in the graph data
          const maxUpload = sentData.reduce(
            (max, d) => Math.max(max, Number(d.value) || 0),
            0
          );
          const maxDownload = recvData.reduce(
            (max, d) => Math.max(max, Number(d.value) || 0),
            0
          );

          overusageResults.push({
            customerName: customerName || "Unknown",
            interfaceName,
            upmbps: upmbps || null,
            downmbps: downmbps || null,
            // raw max values in bps
            maxUploadBps: maxUpload,
            maxDownloadBps: maxDownload,
            // human-readable max values (bps / Kbps / Mbps / Gbps)
            maxUpload: formatBps(maxUpload),
            maxDownload: formatBps(maxDownload),
            overUploadSamples,
            overDownloadSamples,
            totalUploadSamples: sentData.length,
            totalDownloadSamples: recvData.length,
            cid: cid || null,
            nbr: nbr || null,
            port: port || null,
          });

          console.log(
            `[DIA Overusage] Interface ${interfaceName} (${customerName || "Unknown"}, CID: ${
              cid || "N/A"
            }, NBR: ${nbr || "N/A"}, Port: ${port || "N/A"}) ` +
              `UP over-usage samples: ${overUploadSamples}/${sentData.length}, ` +
              `DOWN over-usage samples: ${overDownloadSamples}/${recvData.length}`
          );
        }
      }

      console.log(
        `[DIA Overusage] Completed daily check. Customers with over-usage: ${customersWithOverusage}.`
      );

      // Persist results to database
      if (overusageResults.length > 0) {
        const now = new Date();
        const records = overusageResults.map((item) => ({
          runAt: now,
          ...item,
        }));
        await DiaOverusageReport.bulkCreate(records);
        console.log(
          `[DIA Overusage] Saved ${overusageResults.length} records to dia_overusage_reports table.`
        );
      } else {
        console.log("[DIA Overusage] No over-usage customers found to store.");
      }

      // Return detailed list of over-usage results as well
      return overusageResults;
    } catch (error) {
      console.error("[DIA Overusage] Error during over-usage check:", error.message);
    }
  };

// Schedule the DIA over-usage job to run every day at 02:00
const scheduleDiaOverusageCron = () => {
  cron.schedule("0 2 * * *", checkDiaOverusage);
  console.log("[DIA Overusage] Cron job scheduled to run daily at 02:00.");
};

module.exports = {
  checkDiaOverusage,
  scheduleDiaOverusageCron,
};

