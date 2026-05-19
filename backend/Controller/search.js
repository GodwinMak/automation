const db = require("../Models");
const { Op } = require("sequelize");

const CustomerInfo = db.customerinfos;
const DiaCustomer = db.diacustomers;
const IptCustomerInfo = db.iptcustomerinfos;
const IptCustomer = db.iptcustomers;
const SharedCustomerInfo = db.sharedcustomerinfos;
const SharedCustomer = db.sharedcustomers;
const L3VPNCustomerInfo = db.l3vpncustomerinfos;
const L3VPNCustomer = db.l3vpncustomers;
const FTTHCustomer = db.ftthcustomers;

exports.globalSearch = async (req, res) => {
  const query = req.query.q || "";
  const limit = parseInt(req.query.limit) || 10;

  if (!query || query.length < 2) {
    return res.status(200).json({ results: [] });
  }

  try {
    const searchPattern = `%${query}%`;

    // Search DIA Customers (include client_db fields)
    const diaResults = await CustomerInfo.findAll({
      where: {
        [Op.or]: [
          { customerName: { [Op.like]: searchPattern } },
          { cid: { [Op.like]: searchPattern } },
          { interface: { [Op.like]: searchPattern } },
          { nbr: { [Op.like]: searchPattern } },
          // client_db fields (left-joined)
          db.Sequelize.where(db.Sequelize.col('client_db.email_address'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.phone_number'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.customer_name_pastel'), { [Op.like]: searchPattern }),
        ],
      },
      include: [
        {
          model: DiaCustomer,
          attributes: ["operationalStatus", "switchName"],
        },
        {
          model: db.client_dbs,
          // attributes: [],
          required: false,
        },
      ],
      limit: limit,
    });

    // Search IPT Customers (include client_db fields)
    const iptResults = await IptCustomerInfo.findAll({
      where: {
        [Op.or]: [
          { customerName: { [Op.like]: searchPattern } },
          { cid: { [Op.like]: searchPattern } },
          { interface: { [Op.like]: searchPattern } },
          { nbr: { [Op.like]: searchPattern } },
          db.Sequelize.where(db.Sequelize.col('client_db.email_address'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.phone_number'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.customer_name_pastel'), { [Op.like]: searchPattern }),
        ],
      },
      include: [
        {
          model: IptCustomer,
          attributes: ["operationalStatus", "switchName"],
        },
        {
          model: db.client_dbs,
          // attributes: [],
          required: false,
        },
      ],
      limit: limit,
    });

    // Search Shared Customers (include client_db fields)
    const sharedResults = await SharedCustomerInfo.findAll({
      where: {
        [Op.or]: [
          { customerName: { [Op.like]: searchPattern } },
          { cid: { [Op.like]: searchPattern } },
          { interface: { [Op.like]: searchPattern } },
          { nbr: { [Op.like]: searchPattern } },
          db.Sequelize.where(db.Sequelize.col('client_db.email_address'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.phone_number'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.customer_name_pastel'), { [Op.like]: searchPattern }),
        ],
      },
      include: [
        {
          model: SharedCustomer,
          attributes: ["operationalStatus", "switchName"],
        },
        {
          model: db.client_dbs,
          // attributes: [],
          required: false,
        },
      ],
      limit: limit,
    });

    // Search L3VPN Customers
    const l3vpnResults = await L3VPNCustomerInfo.findAll({
      where: {
        [Op.or]: [
          { customerName: { [Op.like]: searchPattern } },
          { cid: { [Op.like]: searchPattern } },
          { interface: { [Op.like]: searchPattern } },
          { nbr: { [Op.like]: searchPattern } },
          db.Sequelize.where(db.Sequelize.col('client_db.email_address'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.phone_number'), { [Op.like]: searchPattern }),
          db.Sequelize.where(db.Sequelize.col('client_db.customer_name_pastel'), { [Op.like]: searchPattern }),
        ],
      },
      include: [
        {
          model: L3VPNCustomer,
          attributes: ["operationalStatus", "switchName"],
        },
        {
          model: db.client_dbs,
          required: false,
        },
      ],
      limit: limit,
    });

    // Search FTTH Customers by pppoeusername, ip, customerID, or customerName
    const ftthResults = await FTTHCustomer.findAll({
      where: {
        [Op.or]: [
          { pppoeusername: { [Op.like]: searchPattern } },
          { ip: { [Op.like]: searchPattern } },
          { customerID: { [Op.like]: searchPattern } },
          { customerName: { [Op.like]: searchPattern } },
        ],
      },
      limit: limit,
    });

    // Format results with type identifier
    const formattedResults = [
      ...diaResults.map((item) => ({
        id: item.id,
        customerName: item.customerName,
        cid: item.cid,
        interface: item.interface,
        nbr: item.nbr,
        status: item.diacustomer?.operationalStatus || "unknown",
        switchName: item.diacustomer?.switchName || "",
        type: "DIA",
        route: "/viewcustomer",
        data: item,
      })),
      ...iptResults.map((item) => ({
        id: item.id,
        customerName: item.customerName,
        cid: item.cid,
        interface: item.interface,
        nbr: item.nbr,
        status: item.iptcustomer?.operationalStatus || "unknown",
        switchName: item.iptcustomer?.switchName || "",
        type: "IPT",
        route: "/view-ipt-customer",
        data: item,
      })),
      ...sharedResults.map((item) => ({
        id: item.id,
        customerName: item.customerName,
        cid: item.cid,
        interface: item.interface,
        nbr: item.nbr,
        status: item.sharedcustomer?.operationalStatus || "unknown",
        switchName: item.sharedcustomer?.switchName || "",
        type: "Shared",
        route: "/view-shared-customer",
        data: item,
      })),
      ...l3vpnResults.map((item) => ({
        id: item.id,
        customerName: item.customerName,
        cid: item.cid,
        interface: item.interface,
        nbr: item.nbr,
        status: item.l3vpncustomer?.operationalStatus || "unknown",
        switchName: item.l3vpncustomer?.switchName || "",
        type: "L3VPN",
        route: "/view-l3vpn-customer",
        data: item,
      })),
      ...ftthResults.map((item) => ({
        id: item.id,
        customerName: item.customerName || item.pppoeusername,
        cid: item.customerID || item.ip,
        interface: item.ip_version,
        nbr: item.pppoeusername,
        status: item.status || "unknown",
        switchName: "",
        type: "FTTH",
        route: "/view-ftth-customer",
        data: item,
      })),
    ];

    // Sort by relevance (exact matches first)
    formattedResults.sort((a, b) => {
      const aExact = a.customerName?.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
      const bExact = b.customerName?.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
      return aExact - bExact;
    });

    // Limit total results
    const limitedResults = formattedResults.slice(0, limit * 2);

    res.status(200).json({
      results: limitedResults,
      total: formattedResults.length,
      query: query,
    });
  } catch (error) {
    console.error("Global search error:", error);
    res.status(500).json({ message: "Search failed", error: error.message });
  }
};

