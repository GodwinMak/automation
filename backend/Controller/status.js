const db = require("../Models");

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
      temporaryUpgradesCount,
      permanentUpgradesCount,
      noUpgradesCount,
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
      CustomerInfo.count({ where: { upgrade_type: "temporary" } }),
      CustomerInfo.count({ where: { upgrade_type: "permanent" } }),
      CustomerInfo.count({ where: { upgrade_type: null } }),
    ]);

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
