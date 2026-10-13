const db = require("../Models");
const { computeAllL2VPNCircuits } = require("./l2vpnCircuit.js");

const Device = db.devices;
const CustomerInfo = db.customerinfos;
const DiaCustomer = db.diacustomers;
const IptCustomer = db.iptcustomers;
const SharedCustomer = db.sharedcustomers;
const L3VPNCustomer = db.l3vpncustomers;
const FTTHCustomer = db.ftthcustomers;

// get count of devices available, DIA customers, IPT customers, Shared customers, and upgrades
exports.getStatusCounts = async (req, res) => {
  try {
    // Run all 18 independent COUNT queries in parallel
    const [
      deviceCount,
      upDiaCustomerCount,
      downDiaCustomerCount,
      upIptCustomerCount,
      downIptCustomerCount,
      upSharedCustomerCount,
      downSharedCustomerCount,
      upL3VPNCustomerCount,
      downL3VPNCustomerCount,
      upFTTHCustomerCount,
      downFTTHCustomerCount,
      expiredUpFTTHCount,
      expiredDownFTTHCount,
      activeUpFTTHCount,
      activeDownFTTHCount,
      temporaryUpgradesDiaCount,
      temporaryUpgradesIptCount,
      temporaryUpgradesL3VPNCount,
      permanentUpgradesCount,
      noUpgradesCount,
      freeFTTHCount,
      nonFreeFTTHCount,
      highProfileDiaCount,
      highProfileIptCount,
      highProfileSharedCount,
      highProfileL3VPNCount,
      l2vpnCircuits,
    ] = await Promise.all([
      Device.count(),
      DiaCustomer.count({ where: { operationalStatus: "up" } }),
      DiaCustomer.count({ where: { operationalStatus: "down" } }),
      IptCustomer.count({ where: { operationalStatus: "up" } }),
      IptCustomer.count({ where: { operationalStatus: "down" } }),
      SharedCustomer.count({ where: { operationalStatus: "up" } }),
      SharedCustomer.count({ where: { operationalStatus: "down" } }),
      L3VPNCustomer.count({ where: { operationalStatus: "up" } }),
      L3VPNCustomer.count({ where: { operationalStatus: "down" } }),
      FTTHCustomer.count({ where: { status: "up" } }),
      FTTHCustomer.count({ where: { status: "down" } }),
      FTTHCustomer.count({ where: { isExpired: true, status: "up" } }),
      FTTHCustomer.count({ where: { isExpired: true, status: "down" } }),
      FTTHCustomer.count({ where: { isExpired: false, status: "up" } }),
      FTTHCustomer.count({ where: { isExpired: false, status: "down" } }),
      // Temporary upgrades span every customer type that actually carries an
      // upgrade_type column — DIA, IPT, L3VPN (see Models/customerinfo.js,
      // iptcustomerinfo.js, L3VPNCustomerinfo.js). SHARED has no such column
      // at all (Models/sharedCustomerinfo.js) and L2VPN has no customerinfo
      // table/upgrade concept — neither can ever have a temporary upgrade,
      // so they're not queried here rather than always contributing zero.
      CustomerInfo.count({ where: { upgrade_type: "temporary" } }),
      db.iptcustomerinfos.count({ where: { upgrade_type: "temporary" } }),
      db.l3vpncustomerinfos.count({ where: { upgrade_type: "temporary" } }),
      CustomerInfo.count({ where: { upgrade_type: "permanent" } }),
      CustomerInfo.count({ where: { upgrade_type: null } }),
      FTTHCustomer.count({ where: { isFreeCustomer: true } }),
      FTTHCustomer.count({ where: { isFreeCustomer: false } }),
      CustomerInfo.count({ where: { isHighProfile: true } }),
      db.iptcustomerinfos.count({ where: { isHighProfile: true } }),
      db.sharedcustomerinfos.count({ where: { isHighProfile: true } }),
      db.l3vpncustomerinfos.count({ where: { isHighProfile: true } }),
      computeAllL2VPNCircuits(),
    ]);

    // L2VPN circuits are multi-hop (2+ devices), unlike every other
    // customer type here — overallOperationalStatus is already "up" only
    // when every hop agrees, "down" only when every hop agrees, and
    // "mixed" otherwise (one leg of the path broken). Counted as its own
    // bucket rather than folded into up/down, since a mixed circuit is
    // degraded but not equivalent to either.
    let upL2VPNCircuitCount = 0;
    let mixedL2VPNCircuitCount = 0;
    let downL2VPNCircuitCount = 0;
    for (const circuit of l2vpnCircuits) {
      if (circuit.overallOperationalStatus === "up") upL2VPNCircuitCount++;
      else if (circuit.overallOperationalStatus === "down") downL2VPNCircuitCount++;
      else mixedL2VPNCircuitCount++;
    }

    const temporaryUpgradesCount =
      temporaryUpgradesDiaCount + temporaryUpgradesIptCount + temporaryUpgradesL3VPNCount;

    res.status(200).json({
      deviceCount,
      upDiaCustomerCount,
      downDiaCustomerCount,
      upIptCustomerCount,
      downIptCustomerCount,
      upSharedCustomerCount,
      downSharedCustomerCount,
      upL3VPNCustomerCount,
      downL3VPNCustomerCount,
      upFTTHCustomerCount,
      downFTTHCustomerCount,
      expiredUpFTTHCount,
      expiredDownFTTHCount,
      activeUpFTTHCount,
      activeDownFTTHCount,
      temporaryUpgradesCount,
      permanentUpgradesCount,
      noUpgradesCount,
      freeFTTHCount,
      nonFreeFTTHCount,
      highProfileCustomerCount:
        highProfileDiaCount + highProfileIptCount + highProfileSharedCount + highProfileL3VPNCount,
      upL2VPNCircuitCount,
      mixedL2VPNCircuitCount,
      downL2VPNCircuitCount,
    });
  } catch (error) {
    console.error("Error fetching status counts:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getCustomerInfoByUpgradeType = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 5;
    const offset = (page - 1) * pageSize;
    const statusFilter = req.query.status || ""; // 👈 new
    const { upgradeType } = req.params;
    let whereClause = {};

    if (upgradeType === "temporary" || upgradeType === "permanent") {
      whereClause.upgrade_type = upgradeType;
    } else if (upgradeType === "none") {
      whereClause.upgrade_type = null;
    } else {
      return res.status(400).json({ message: "Invalid upgrade type" });
    }

    const { count, rows } = await CustomerInfo.findAndCountAll({
       offset,
      limit: pageSize,
      where: whereClause,
      include: [
        {
          model: db.diacustomers,
          attributes: ["operationalStatus", "switchName"],
          where:
            statusFilter && statusFilter !== "all"
              ? { operationalStatus: statusFilter }
              : undefined, // 👈 apply only if filter is set
        },
      ],
    });
    const totalPages = Math.ceil(count / pageSize);

    res.status(200).json({
      customers: rows,
      totalItems: count,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Every non-FTTH customer currently on a temporary upgrade, across every
// type that actually carries an upgrade_type column — DIA, IPT, L3VPN.
// SHARED has no upgrade_type column at all and L2VPN has no customerinfo
// table/upgrade concept, so neither can ever appear here (see the
// temporaryUpgradesCount comment in getStatusCounts above for the same
// reasoning). Unpaginated — a live temporary-upgrade backlog is small
// enough (customers actively mid-upgrade right now) that this is meant to
// be an at-a-glance list, not a browsable table.
exports.getAllTemporaryUpgrades = async (req, res) => {
  try {
    const [diaRows, iptRows, l3vpnRows] = await Promise.all([
      CustomerInfo.findAll({
        where: { upgrade_type: "temporary" },
        include: [{ model: DiaCustomer, attributes: ["operationalStatus", "switchName"] }],
      }),
      db.iptcustomerinfos.findAll({
        where: { upgrade_type: "temporary" },
        include: [{ model: IptCustomer, attributes: ["operationalStatus", "switchName"] }],
      }),
      db.l3vpncustomerinfos.findAll({
        where: { upgrade_type: "temporary" },
        include: [{ model: L3VPNCustomer, attributes: ["operationalStatus", "switchName"] }],
      }),
    ]);

    const tag = (rows, customerType) =>
      rows.map((r) => ({ ...r.toJSON(), customerType }));

    const customers = [
      ...tag(diaRows, "DIA"),
      ...tag(iptRows, "IPT"),
      ...tag(l3vpnRows, "L3VPN"),
    ].sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));

    res.status(200).json({ customers, totalItems: customers.length });
  } catch (error) {
    console.error("Error fetching temporary upgrades:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
