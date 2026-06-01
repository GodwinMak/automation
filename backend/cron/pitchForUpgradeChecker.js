const cron = require("node-cron");
const db = require("../Models");
const { getZabbixHistory } = require("../Controller/diagnosis");

// This job finds DIA customers where a significant portion (>40%) of
// samples in the last 24 hours exceed 95% of provisioned capacity.
const checkPitchForUpgrade = async () => {
  try {
    console.log("[PitchForUpgrade] Starting daily pitch-for-upgrade check (last 24h)...");

    const DiaCustomer = db.diacustomers;
    const CustomerInfo = db.customerinfos;

    const diaCustomers = await DiaCustomer.findAll({
      include: [{ model: CustomerInfo }],
    });

    console.log(`[PitchForUpgrade] Evaluating ${diaCustomers.length} DIA customers.`);

    const PitchModel = db.pitchForUpgradeReports;

    // Remove previous results that are not in the new run
    const prevReports = await PitchModel.findAll();
    const newKeys = new Set();
    // Build unique keys for new results
    for (const customer of diaCustomers) {
      const infos = customer.customerinfos || [];
      const info = Array.isArray(infos) ? infos[0] : infos;
      if (!info) continue;
      const { cid, customerName } = info;
      const interfaceName = customer.interface;
      if (!interfaceName) continue;
      const uniqueKey = `${cid || customerName}_${interfaceName}`;
      newKeys.add(uniqueKey);
    }
    // Delete previous reports not in newKeys
    for (const report of prevReports) {
      const uniqueKey = `${report.cid || report.customerName}_${report.interfaceName}`;
      if (!newKeys.has(uniqueKey)) {
        await PitchModel.destroy({ where: { id: report.id } });
      }
    }

    const results = [];

    // Pre-deduplicate by uniqueKey, then process 5 at a time concurrently
    const seenKeys = new Set();
    const toProcess = diaCustomers.filter((customer) => {
      const infos = customer.customerinfos || [];
      const info = Array.isArray(infos) ? infos[0] : infos;
      if (!info) return false;
      const { cid, customerName } = info;
      const interfaceName = customer.interface;
      const switchName = customer.switchName;
      if (!interfaceName || !switchName) return false;
      const uniqueKey = `${cid || customerName}_${interfaceName}`;
      if (seenKeys.has(uniqueKey)) return false;
      seenKeys.add(uniqueKey);
      return true;
    });

    const checkUpgrade = async (customer) => {
      const infos = customer.customerinfos || [];
      const info = Array.isArray(infos) ? infos[0] : infos;
      const { upmbps, downmbps, customerName, cid, nbr, port } = info;
      const interfaceName = customer.interface;
      const switchName = customer.switchName;
      const zabbixData = await getZabbixHistory(interfaceName, switchName, 24);
      if (!zabbixData) return null;
      const sent = Array.isArray(zabbixData.sentData) ? zabbixData.sentData : [];
      const recv = Array.isArray(zabbixData.recvData) ? zabbixData.recvData : [];
      const upCapacityBps = upmbps ? upmbps * 1e6 : 0;
      const downCapacityBps = downmbps ? downmbps * 1e6 : 0;
      const upThreshold = upCapacityBps > 0 ? upCapacityBps * 0.95 : 0;
      const downThreshold = downCapacityBps > 0 ? downCapacityBps * 0.95 : 0;
      const overUploadSamples = upThreshold > 0 ? sent.filter((d) => Number(d.value) >= upThreshold).length : 0;
      const overDownloadSamples = downThreshold > 0 ? recv.filter((d) => Number(d.value) >= downThreshold).length : 0;
      const totalUploadSamples = sent.length;
      const totalDownloadSamples = recv.length;
      const uploadRatio = totalUploadSamples > 0 ? overUploadSamples / totalUploadSamples : 0;
      const downloadRatio = totalDownloadSamples > 0 ? overDownloadSamples / totalDownloadSamples : 0;
      if (uploadRatio <= 0.4 && downloadRatio <= 0.4) return null;
      return {
        runAt: new Date(),
        customerName: customerName || "Unknown",
        interfaceName,
        upmbps: upmbps || null,
        downmbps: downmbps || null,
        samplesOver95Upload: overUploadSamples,
        samplesOver95Download: overDownloadSamples,
        totalUploadSamples,
        totalDownloadSamples,
        pctOver95Upload: Number((uploadRatio * 100).toFixed(2)),
        pctOver95Download: Number((downloadRatio * 100).toFixed(2)),
        cid: cid || null,
        nbr: nbr || null,
        port: port || null,
      };
    };

    for (let i = 0; i < toProcess.length; i += 5) {
      const chunk = toProcess.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(checkUpgrade));
      for (const item of chunkResults) {
        if (item) results.push(item);
      }
    }

    // Persist results
    if (results.length > 0) {
      await PitchModel.bulkCreate(results);
      console.log(`[PitchForUpgrade] Saved ${results.length} pitch-for-upgrade records.`);
    } else {
      console.log('[PitchForUpgrade] No pitch candidates found this run.');
    }

    return results;
  } catch (error) {
    console.error('[PitchForUpgrade] Error during check:', error.message || error);
  }
};

const schedulePitchForUpgradeCron = () => {
  cron.schedule('0 2 * * *', checkPitchForUpgrade);
  console.log('[PitchForUpgrade] Cron job scheduled to run daily at 02:00.');
};

module.exports = { checkPitchForUpgrade, schedulePitchForUpgradeCron };
