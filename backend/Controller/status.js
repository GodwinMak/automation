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
    const deviceCount = await Device.count();
    
    // DIA Customer counts
    const upDiaCustomerCount = await DiaCustomer.count({
      where: { operationalStatus: "up" },
    });
    const downDiaCustomerCount = await DiaCustomer.count({
      where: { operationalStatus: "down" },
    });
    
    // IPT Customer counts
    const upIptCustomerCount = await IptCustomer.count({
      where: { operationalStatus: "up" },
    });
    const downIptCustomerCount = await IptCustomer.count({
      where: { operationalStatus: "down" },
    });

    // Shared Customer counts
    const upSharedCustomerCount = await SharedCustomer.count({
      where: { operationalStatus: "up" },
    });
    const downSharedCustomerCount = await SharedCustomer.count({
      where: { operationalStatus: "down" },
    });

    // L3VPN Customer counts
    const upL3VPNCustomerCount = await L3VPNCustomer.count({
      where: { operationalStatus: "up" },
    });
    const downL3VPNCustomerCount = await L3VPNCustomer.count({
      where: { operationalStatus: "down" },
    });

    // FTTH Customer counts
    const upFTTHCustomerCount = await FTTHCustomer.count({
      where: { status: "up" },
    });
    const downFTTHCustomerCount = await FTTHCustomer.count({
      where: { status: "down" },
    });

    // FTTH Expired / Active (not expired) counts
    const expiredUpFTTHCount = await FTTHCustomer.count({
      where: { isExpired: true, status: "up" },
    });
    const expiredDownFTTHCount = await FTTHCustomer.count({
      where: { isExpired: true, status: "down" },
    });
    const activeUpFTTHCount = await FTTHCustomer.count({
      where: { isExpired: false, status: "up" },
    });
    const activeDownFTTHCount = await FTTHCustomer.count({
      where: { isExpired: false, status: "down" },
    });
    
    // Upgrade counts
    const temporaryUpgradesCount = await CustomerInfo.count({
      where: { upgrade_type: "temporary" },
    });
    const permanentUpgradesCount = await CustomerInfo.count({
      where: { upgrade_type: "permanent" },
    });
    const noUpgradesCount = await CustomerInfo.count({
      where: { upgrade_type: null },
    });

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
