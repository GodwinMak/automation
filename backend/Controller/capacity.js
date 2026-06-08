const db = require("../Models");
const { Op, fn, col, literal } = require("sequelize");

const CustomerInfo = db.customerinfos;
const DiaCustomer = db.diacustomers;
const IptCustomerInfo = db.iptcustomerinfos;
const IptCustomer = db.iptcustomers;
const SharedCustomerInfo = db.sharedcustomerinfos;
const SharedCustomer = db.sharedcustomers;

// Get capacity summary by NBR (switch)
exports.getCapacitySummary = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const sortBy = req.query.sortBy || "total_capacity";
  const sortOrder = req.query.sortOrder || "desc";

  try {
    // Run all 9 capacity queries in parallel
    const [
      diaCapacity,
      diaUpCapacity,
      diaDownCapacity,
      iptCapacity,
      iptUpCapacity,
      iptDownCapacity,
      sharedCapacity,
      sharedUpCapacity,
      sharedDownCapacity,
    ] = await Promise.all([
      // DIA capacity by NBR (total)
      CustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("customerinfo.downmbps")), "dia_capacity"],
          [fn("COUNT", col("customerinfo.id")), "dia_customers"],
        ],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // DIA UP capacity by NBR
      CustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("customerinfo.downmbps")), "capacity"],
          [fn("COUNT", col("customerinfo.id")), "count"],
        ],
        include: [{ model: DiaCustomer, attributes: [], where: { operationalStatus: "up" } }],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // DIA DOWN capacity by NBR
      CustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("customerinfo.downmbps")), "capacity"],
          [fn("COUNT", col("customerinfo.id")), "count"],
        ],
        include: [{ model: DiaCustomer, attributes: [], where: { operationalStatus: "down" } }],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // IPT capacity by NBR (total)
      IptCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("iptcustomerinfo.downmbps")), "ipt_capacity"],
          [fn("COUNT", col("iptcustomerinfo.id")), "ipt_customers"],
        ],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // IPT UP capacity by NBR
      IptCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("iptcustomerinfo.downmbps")), "capacity"],
          [fn("COUNT", col("iptcustomerinfo.id")), "count"],
        ],
        include: [{ model: IptCustomer, attributes: [], where: { operationalStatus: "up" } }],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // IPT DOWN capacity by NBR
      IptCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("iptcustomerinfo.downmbps")), "capacity"],
          [fn("COUNT", col("iptcustomerinfo.id")), "count"],
        ],
        include: [{ model: IptCustomer, attributes: [], where: { operationalStatus: "down" } }],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // Shared capacity by NBR (total)
      SharedCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("sharedcustomerinfo.capacity")), "shared_capacity"],
          [fn("COUNT", col("sharedcustomerinfo.id")), "shared_customers"],
        ],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // Shared UP capacity by NBR
      SharedCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("sharedcustomerinfo.capacity")), "capacity"],
          [fn("COUNT", col("sharedcustomerinfo.id")), "count"],
        ],
        include: [{ model: SharedCustomer, attributes: [], where: { operationalStatus: "up" } }],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
      // Shared DOWN capacity by NBR
      SharedCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("sharedcustomerinfo.capacity")), "capacity"],
          [fn("COUNT", col("sharedcustomerinfo.id")), "count"],
        ],
        include: [{ model: SharedCustomer, attributes: [], where: { operationalStatus: "down" } }],
        where: { nbr: { [Op.like]: `%${searchQuery}%` } },
        group: ["nbr"],
        raw: true,
      }),
    ]);

    // Create lookup maps for UP/DOWN data
    const diaUpMap = new Map(diaUpCapacity.map(i => [i.nbr, { capacity: parseInt(i.capacity) || 0, count: parseInt(i.count) || 0 }]));
    const diaDownMap = new Map(diaDownCapacity.map(i => [i.nbr, { capacity: parseInt(i.capacity) || 0, count: parseInt(i.count) || 0 }]));
    const iptUpMap = new Map(iptUpCapacity.map(i => [i.nbr, { capacity: parseInt(i.capacity) || 0, count: parseInt(i.count) || 0 }]));
    const iptDownMap = new Map(iptDownCapacity.map(i => [i.nbr, { capacity: parseInt(i.capacity) || 0, count: parseInt(i.count) || 0 }]));
    const sharedUpMap = new Map(sharedUpCapacity.map(i => [i.nbr, { capacity: parseInt(i.capacity) || 0, count: parseInt(i.count) || 0 }]));
    const sharedDownMap = new Map(sharedDownCapacity.map(i => [i.nbr, { capacity: parseInt(i.capacity) || 0, count: parseInt(i.count) || 0 }]));

    // Merge all data by NBR
    const capacityMap = new Map();

    // Process DIA
    diaCapacity.forEach((item) => {
      if (!item.nbr) return;
      const upData = diaUpMap.get(item.nbr) || { capacity: 0, count: 0 };
      const downData = diaDownMap.get(item.nbr) || { capacity: 0, count: 0 };
      capacityMap.set(item.nbr, {
        nbr: item.nbr,
        dia_capacity: parseInt(item.dia_capacity) || 0,
        dia_customers: parseInt(item.dia_customers) || 0,
        dia_up_capacity: upData.capacity,
        dia_up_count: upData.count,
        dia_down_capacity: downData.capacity,
        dia_down_count: downData.count,
        ipt_capacity: 0,
        ipt_customers: 0,
        ipt_up_capacity: 0,
        ipt_up_count: 0,
        ipt_down_capacity: 0,
        ipt_down_count: 0,
        shared_capacity: 0,
        shared_customers: 0,
        shared_up_capacity: 0,
        shared_up_count: 0,
        shared_down_capacity: 0,
        shared_down_count: 0,
      });
    });

    // Process IPT
    iptCapacity.forEach((item) => {
      if (!item.nbr) return;
      const upData = iptUpMap.get(item.nbr) || { capacity: 0, count: 0 };
      const downData = iptDownMap.get(item.nbr) || { capacity: 0, count: 0 };
      if (capacityMap.has(item.nbr)) {
        const existing = capacityMap.get(item.nbr);
        existing.ipt_capacity = parseInt(item.ipt_capacity) || 0;
        existing.ipt_customers = parseInt(item.ipt_customers) || 0;
        existing.ipt_up_capacity = upData.capacity;
        existing.ipt_up_count = upData.count;
        existing.ipt_down_capacity = downData.capacity;
        existing.ipt_down_count = downData.count;
      } else {
        capacityMap.set(item.nbr, {
          nbr: item.nbr,
          dia_capacity: 0,
          dia_customers: 0,
          dia_up_capacity: 0,
          dia_up_count: 0,
          dia_down_capacity: 0,
          dia_down_count: 0,
          ipt_capacity: parseInt(item.ipt_capacity) || 0,
          ipt_customers: parseInt(item.ipt_customers) || 0,
          ipt_up_capacity: upData.capacity,
          ipt_up_count: upData.count,
          ipt_down_capacity: downData.capacity,
          ipt_down_count: downData.count,
          shared_capacity: 0,
          shared_customers: 0,
          shared_up_capacity: 0,
          shared_up_count: 0,
          shared_down_capacity: 0,
          shared_down_count: 0,
        });
      }
    });

    // Process Shared
    sharedCapacity.forEach((item) => {
      if (!item.nbr) return;
      const upData = sharedUpMap.get(item.nbr) || { capacity: 0, count: 0 };
      const downData = sharedDownMap.get(item.nbr) || { capacity: 0, count: 0 };
      if (capacityMap.has(item.nbr)) {
        const existing = capacityMap.get(item.nbr);
        existing.shared_capacity = parseInt(item.shared_capacity) || 0;
        existing.shared_customers = parseInt(item.shared_customers) || 0;
        existing.shared_up_capacity = upData.capacity;
        existing.shared_up_count = upData.count;
        existing.shared_down_capacity = downData.capacity;
        existing.shared_down_count = downData.count;
      } else {
        capacityMap.set(item.nbr, {
          nbr: item.nbr,
          dia_capacity: 0,
          dia_customers: 0,
          dia_up_capacity: 0,
          dia_up_count: 0,
          dia_down_capacity: 0,
          dia_down_count: 0,
          ipt_capacity: 0,
          ipt_customers: 0,
          ipt_up_capacity: 0,
          ipt_up_count: 0,
          ipt_down_capacity: 0,
          ipt_down_count: 0,
          shared_capacity: parseInt(item.shared_capacity) || 0,
          shared_customers: parseInt(item.shared_customers) || 0,
          shared_up_capacity: upData.capacity,
          shared_up_count: upData.count,
          shared_down_capacity: downData.capacity,
          shared_down_count: downData.count,
        });
      }
    });

    // Convert to array and calculate totals
    let results = Array.from(capacityMap.values()).map((item) => ({
      ...item,
      total_capacity: item.dia_capacity + item.ipt_capacity + item.shared_capacity,
      total_customers: item.dia_customers + item.ipt_customers + item.shared_customers,
      total_up_capacity: item.dia_up_capacity + item.ipt_up_capacity + item.shared_up_capacity,
      total_up_count: item.dia_up_count + item.ipt_up_count + item.shared_up_count,
      total_down_capacity: item.dia_down_capacity + item.ipt_down_capacity + item.shared_down_capacity,
      total_down_count: item.dia_down_count + item.ipt_down_count + item.shared_down_count,
    }));

    // Sort
    results.sort((a, b) => {
      const aVal = a[sortBy] || 0;
      const bVal = b[sortBy] || 0;
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    const totalItems = results.length;
    const totalPages = Math.ceil(totalItems / pageSize);

    // Paginate
    const paginatedResults = results.slice(offset, offset + pageSize);

    // Calculate grand totals
    const grandTotals = results.reduce(
      (acc, item) => ({
        total_dia_capacity: acc.total_dia_capacity + item.dia_capacity,
        total_ipt_capacity: acc.total_ipt_capacity + item.ipt_capacity,
        total_shared_capacity: acc.total_shared_capacity + item.shared_capacity,
        total_capacity: acc.total_capacity + item.total_capacity,
        total_dia_customers: acc.total_dia_customers + item.dia_customers,
        total_ipt_customers: acc.total_ipt_customers + item.ipt_customers,
        total_shared_customers: acc.total_shared_customers + item.shared_customers,
        total_customers: acc.total_customers + item.total_customers,
      }),
      {
        total_dia_capacity: 0,
        total_ipt_capacity: 0,
        total_shared_capacity: 0,
        total_capacity: 0,
        total_dia_customers: 0,
        total_ipt_customers: 0,
        total_shared_customers: 0,
        total_customers: 0,
      }
    );

    res.status(200).json({
      data: paginatedResults,
      totals: grandTotals,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Capacity summary error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get overall capacity stats
exports.getCapacityStats = async (req, res) => {
  try {
    // Run all 15 independent stat queries in parallel
    const [
      diaStats,
      diaUpCount,
      diaDownCount,
      diaUpStats,
      diaDownStats,
      iptStats,
      iptUpCount,
      iptDownCount,
      iptUpStats,
      iptDownStats,
      sharedStats,
      sharedUpCount,
      sharedDownCount,
      sharedUpStats,
      sharedDownStats,
      uniqueSwitches,
      iptSwitches,
      sharedSwitches,
    ] = await Promise.all([
      // DIA totals
      CustomerInfo.findOne({
        attributes: [
          [fn("SUM", col("downmbps")), "total_capacity"],
          [fn("COUNT", col("id")), "total_customers"],
        ],
        raw: true,
      }),
      DiaCustomer.count({ where: { operationalStatus: "up" } }),
      DiaCustomer.count({ where: { operationalStatus: "down" } }),
      // DIA UP capacity
      CustomerInfo.findOne({
        attributes: [[fn("SUM", col("customerinfo.downmbps")), "capacity"]],
        include: [{ model: DiaCustomer, attributes: [], where: { operationalStatus: "up" } }],
        raw: true,
      }),
      // DIA DOWN capacity
      CustomerInfo.findOne({
        attributes: [[fn("SUM", col("customerinfo.downmbps")), "capacity"]],
        include: [{ model: DiaCustomer, attributes: [], where: { operationalStatus: "down" } }],
        raw: true,
      }),
      // IPT totals
      IptCustomerInfo.findOne({
        attributes: [
          [fn("SUM", col("downmbps")), "total_capacity"],
          [fn("COUNT", col("id")), "total_customers"],
        ],
        raw: true,
      }),
      IptCustomer.count({ where: { operationalStatus: "up" } }),
      IptCustomer.count({ where: { operationalStatus: "down" } }),
      // IPT UP capacity
      IptCustomerInfo.findOne({
        attributes: [[fn("SUM", col("iptcustomerinfo.downmbps")), "capacity"]],
        include: [{ model: IptCustomer, attributes: [], where: { operationalStatus: "up" } }],
        raw: true,
      }),
      // IPT DOWN capacity
      IptCustomerInfo.findOne({
        attributes: [[fn("SUM", col("iptcustomerinfo.downmbps")), "capacity"]],
        include: [{ model: IptCustomer, attributes: [], where: { operationalStatus: "down" } }],
        raw: true,
      }),
      // Shared totals
      SharedCustomerInfo.findOne({
        attributes: [
          [fn("SUM", col("capacity")), "total_capacity"],
          [fn("COUNT", col("id")), "total_customers"],
        ],
        raw: true,
      }),
      SharedCustomer.count({ where: { operationalStatus: "up" } }),
      SharedCustomer.count({ where: { operationalStatus: "down" } }),
      // Shared UP capacity
      SharedCustomerInfo.findOne({
        attributes: [[fn("SUM", col("sharedcustomerinfo.capacity")), "capacity"]],
        include: [{ model: SharedCustomer, attributes: [], where: { operationalStatus: "up" } }],
        raw: true,
      }),
      // Shared DOWN capacity
      SharedCustomerInfo.findOne({
        attributes: [[fn("SUM", col("sharedcustomerinfo.capacity")), "capacity"]],
        include: [{ model: SharedCustomer, attributes: [], where: { operationalStatus: "down" } }],
        raw: true,
      }),
      // Unique switch counts
      CustomerInfo.count({ distinct: true, col: "nbr" }),
      IptCustomerInfo.count({ distinct: true, col: "nbr" }),
      SharedCustomerInfo.count({ distinct: true, col: "nbr" }),
    ]);

    // Calculate capacity totals
    const diaUpCapacity = parseInt(diaUpStats?.capacity) || 0;
    const diaDownCapacity = parseInt(diaDownStats?.capacity) || 0;

    const iptUpCapacity = parseInt(iptUpStats?.capacity) || 0;
    const iptDownCapacity = parseInt(iptDownStats?.capacity) || 0;

    const sharedUpCapacity = parseInt(sharedUpStats?.capacity) || 0;
    const sharedDownCapacity = parseInt(sharedDownStats?.capacity) || 0;

    res.status(200).json({
      dia: {
        capacity: parseInt(diaStats?.total_capacity) || 0,
        customers: diaUpCount + diaDownCount, // Total from DiaCustomer table
        up: diaUpCount,
        down: diaDownCount,
        upCapacity: diaUpCapacity,
        downCapacity: diaDownCapacity,
      },
      ipt: {
        capacity: parseInt(iptStats?.total_capacity) || 0,
        customers: iptUpCount + iptDownCount, // Total from IptCustomer table
        up: iptUpCount,
        down: iptDownCount,
        upCapacity: iptUpCapacity,
        downCapacity: iptDownCapacity,
      },
      shared: {
        capacity: parseInt(sharedStats?.total_capacity) || 0,
        customers: sharedUpCount + sharedDownCount, // Total from SharedCustomer table
        up: sharedUpCount,
        down: sharedDownCount,
        upCapacity: sharedUpCapacity,
        downCapacity: sharedDownCapacity,
      },
      total: {
        capacity:
          (parseInt(diaStats?.total_capacity) || 0) +
          (parseInt(iptStats?.total_capacity) || 0) +
          (parseInt(sharedStats?.total_capacity) || 0),
        customers: (diaUpCount + diaDownCount) + (iptUpCount + iptDownCount) + (sharedUpCount + sharedDownCount),
        up: diaUpCount + iptUpCount + sharedUpCount,
        down: diaDownCount + iptDownCount + sharedDownCount,
        upCapacity: diaUpCapacity + iptUpCapacity + sharedUpCapacity,
        downCapacity: diaDownCapacity + iptDownCapacity + sharedDownCapacity,
        switches: Math.max(uniqueSwitches, iptSwitches, sharedSwitches),
      },
    });
  } catch (error) {
    console.error("Capacity stats error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get top switches by capacity
exports.getTopSwitches = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const type = req.query.type || "all"; // all, dia, ipt, shared

  try {
    let results = [];

    if (type === "all" || type === "dia") {
      const diaTop = await CustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("downmbps")), "capacity"],
          [fn("COUNT", col("customerinfo.id")), "customers"],
        ],
        where: { nbr: { [Op.ne]: null } },
        group: ["nbr"],
        order: [[literal("capacity"), "DESC"]],
        limit: limit,
        raw: true,
      });
      results.push(...diaTop.map((r) => ({ ...r, type: "DIA" })));
    }

    if (type === "all" || type === "ipt") {
      const iptTop = await IptCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("downmbps")), "capacity"],
          [fn("COUNT", col("iptcustomerinfo.id")), "customers"],
        ],
        where: { nbr: { [Op.ne]: null } },
        group: ["nbr"],
        order: [[literal("capacity"), "DESC"]],
        limit: limit,
        raw: true,
      });
      results.push(...iptTop.map((r) => ({ ...r, type: "IPT" })));
    }

    if (type === "all" || type === "shared") {
      const sharedTop = await SharedCustomerInfo.findAll({
        attributes: [
          "nbr",
          [fn("SUM", col("capacity")), "capacity"],
          [fn("COUNT", col("sharedcustomerinfo.id")), "customers"],
        ],
        where: { nbr: { [Op.ne]: null } },
        group: ["nbr"],
        order: [[literal("capacity"), "DESC"]],
        limit: limit,
        raw: true,
      });
      results.push(...sharedTop.map((r) => ({ ...r, type: "Shared" })));
    }

    // Sort by capacity and limit
    results.sort((a, b) => (parseInt(b.capacity) || 0) - (parseInt(a.capacity) || 0));
    results = results.slice(0, limit);

    res.status(200).json({ data: results });
  } catch (error) {
    console.error("Top switches error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

