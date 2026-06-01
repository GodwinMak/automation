const cron = require("node-cron");
const db = require("../Models");
const { fn, col } = require("sequelize");

const DiaCustomer = db.diacustomers;
const CustomerInfo = db.customerinfos;
const IptCustomer = db.iptcustomers;
const IptCustomerInfo = db.iptcustomerinfos;
const SharedCustomer = db.sharedcustomers;
const SharedCustomerInfo = db.sharedcustomerinfos;
const UptimeHistory = db.uptimehistories;

// Record current status snapshot
const recordSnapshot = async () => {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const hour = now.getHours();

  console.log(`[Uptime Tracker] Recording snapshot for ${date} hour ${hour}`);

  try {
    // Run all statistics queries in parallel to reduce total DB round-trips
    const [
      diaUp, diaDown,
      diaUpCapacity, diaTotalCapacity,
      iptUp, iptDown,
      iptUpCapacity, iptTotalCapacity,
      sharedUp, sharedDown,
      sharedUpCapacity, sharedTotalCapacity,
    ] = await Promise.all([
      DiaCustomer.count({ where: { operationalStatus: "up" } }),
      DiaCustomer.count({ where: { operationalStatus: "down" } }),
      CustomerInfo.sum("downmbps", {
        include: [{ model: DiaCustomer, attributes: [], where: { operationalStatus: "up" } }],
      }).then(v => v || 0),
      CustomerInfo.sum("downmbps").then(v => v || 0),
      IptCustomer.count({ where: { operationalStatus: "up" } }),
      IptCustomer.count({ where: { operationalStatus: "down" } }),
      IptCustomerInfo.sum("downmbps", {
        include: [{ model: IptCustomer, attributes: [], where: { operationalStatus: "up" } }],
      }).then(v => v || 0),
      IptCustomerInfo.sum("downmbps").then(v => v || 0),
      SharedCustomer.count({ where: { operationalStatus: "up" } }),
      SharedCustomer.count({ where: { operationalStatus: "down" } }),
      SharedCustomerInfo.sum("capacity", {
        include: [{ model: SharedCustomer, attributes: [], where: { operationalStatus: "up" } }],
      }).then(v => v || 0),
      SharedCustomerInfo.sum("capacity").then(v => v || 0),
    ]);

    const diaTotal = diaUp + diaDown;
    const iptTotal = iptUp + iptDown;
    const sharedTotal = sharedUp + sharedDown;

    // Calculate percentages
    const diaUptimePercent = diaTotal > 0 ? (diaUp / diaTotal) * 100 : 0;
    const iptUptimePercent = iptTotal > 0 ? (iptUp / iptTotal) * 100 : 0;
    const sharedUptimePercent = sharedTotal > 0 ? (sharedUp / sharedTotal) * 100 : 0;

    const allTotal = diaTotal + iptTotal + sharedTotal;
    const allUp = diaUp + iptUp + sharedUp;
    const allDown = diaDown + iptDown + sharedDown;
    const allUptimePercent = allTotal > 0 ? (allUp / allTotal) * 100 : 0;

    // Upsert DIA record
    await UptimeHistory.upsert({
      date,
      hour,
      customerType: "DIA",
      totalCustomers: diaTotal,
      upCount: diaUp,
      downCount: diaDown,
      uptimePercentage: parseFloat(diaUptimePercent.toFixed(2)),
      totalCapacity: diaTotalCapacity,
      upCapacity: diaUpCapacity,
      downCapacity: diaTotalCapacity - diaUpCapacity,
    });

    // Upsert IPT record
    await UptimeHistory.upsert({
      date,
      hour,
      customerType: "IPT",
      totalCustomers: iptTotal,
      upCount: iptUp,
      downCount: iptDown,
      uptimePercentage: parseFloat(iptUptimePercent.toFixed(2)),
      totalCapacity: iptTotalCapacity,
      upCapacity: iptUpCapacity,
      downCapacity: iptTotalCapacity - iptUpCapacity,
    });

    // Upsert Shared record
    await UptimeHistory.upsert({
      date,
      hour,
      customerType: "Shared",
      totalCustomers: sharedTotal,
      upCount: sharedUp,
      downCount: sharedDown,
      uptimePercentage: parseFloat(sharedUptimePercent.toFixed(2)),
      totalCapacity: sharedTotalCapacity,
      upCapacity: sharedUpCapacity,
      downCapacity: sharedTotalCapacity - sharedUpCapacity,
    });

    // Upsert ALL combined record
    await UptimeHistory.upsert({
      date,
      hour,
      customerType: "ALL",
      totalCustomers: allTotal,
      upCount: allUp,
      downCount: allDown,
      uptimePercentage: parseFloat(allUptimePercent.toFixed(2)),
      totalCapacity: diaTotalCapacity + iptTotalCapacity + sharedTotalCapacity,
      upCapacity: diaUpCapacity + iptUpCapacity + sharedUpCapacity,
      downCapacity: (diaTotalCapacity - diaUpCapacity) + (iptTotalCapacity - iptUpCapacity) + (sharedTotalCapacity - sharedUpCapacity),
    });

    console.log(`[Uptime Tracker] Snapshot recorded successfully`);
    console.log(`  DIA: ${diaUp}/${diaTotal} (${diaUptimePercent.toFixed(1)}%)`);
    console.log(`  IPT: ${iptUp}/${iptTotal} (${iptUptimePercent.toFixed(1)}%)`);
    console.log(`  Shared: ${sharedUp}/${sharedTotal} (${sharedUptimePercent.toFixed(1)}%)`);
    console.log(`  ALL: ${allUp}/${allTotal} (${allUptimePercent.toFixed(1)}%)`);

  } catch (error) {
    console.error("[Uptime Tracker] Error recording snapshot:", error);
  }
};

// Schedule: Run every hour at minute 0
cron.schedule("0 * * * *", () => {
  console.log("[Uptime Tracker] Hourly snapshot triggered");
  recordSnapshot();
});

// Run immediately on startup to have initial data
setTimeout(() => {
  console.log("[Uptime Tracker] Initial snapshot on startup");
  recordSnapshot();
}, 5000);

module.exports = { recordSnapshot };

