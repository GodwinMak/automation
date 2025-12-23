const db = require("../Models");
const IptCustomerInfo = db.iptcustomerinfos;
const IptCustomer = db.iptcustomers;
const ClientDb = db.client_dbs;
const Sequelize = db.Sequelize;

// Get single IPT customer by ID (with client_db)
exports.getIptCustomerById = async (req, res) => {
  const { id } = req.params;

  try {
    const customer = await IptCustomerInfo.findByPk(id, {
      include: [
        {
          model: IptCustomer,
          attributes: ["operationalStatus", "adminStatus", "switchName", "destination", "description"],
        },
        {
          model: ClientDb,
          attributes: [
            "area",
            "email_address",
            "medium_details",
            "onnet_offnet",
            "customer_name_pastel",
            "phone_number",
            "network_cid",
            "provider",
            "first_name",
            "special_comments",
            "revenue_head",
            "new_customer_type",
          ],
          required: false,
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: "IPT Customer not found" });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching IPT customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAllIptCustomers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 5;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const nbrFilter = req.query.nbr || "";

  try {
    // Build where clause for IptCustomerInfo
    const whereClause = {
      customerName: {
        [Sequelize.Op.like]: `%${searchQuery}%`,
      },
    };

    // Add NBR filter if provided
    if (nbrFilter) {
      whereClause.nbr = {
        [Sequelize.Op.like]: `%${nbrFilter}%`,
      };
    }

    const { count, rows } = await IptCustomerInfo.findAndCountAll({
      offset,
      limit: pageSize,
      where: whereClause,
      include: [
        {
          model: IptCustomer,
          attributes: ["operationalStatus", "switchName", "destination", "adminStatus"],
          where:
            statusFilter && statusFilter !== "all"
              ? { operationalStatus: statusFilter }
              : undefined,
        },
        {
          model: ClientDb,
          attributes: [
            "area",
            "email_address",
            "onnet_offnet",
            "customer_name_pastel",
            "phone_number",
            "network_cid",
            "provider",
          ],
          required: false,
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
    console.error("Error fetching IPT customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getNbrSummary = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 5;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";

  try {
    // 1️⃣ Fetch all grouped NBR rows
    const results = await IptCustomerInfo.findAll({
      attributes: [
        "nbr",
        [Sequelize.fn("COUNT", Sequelize.col("iptcustomerinfo.id")), "total_customers"],
        [Sequelize.fn("SUM", Sequelize.col("iptcustomerinfo.downmbps")), "total_downmbps"],
      ],
      include: [
        {
          model: IptCustomer,
          attributes: [],
        },
      ],
      where: {
        nbr: { [Sequelize.Op.like]: `%${searchQuery}%` },
      },
      group: ["nbr"],
      raw: true,
    });

    // Total rows BEFORE pagination
    const totalItems = results.length;
    const totalPages = Math.ceil(totalItems / pageSize);

    // 2️⃣ Apply pagination AFTER grouping
    const paginated = results.slice(offset, offset + pageSize);

    // 3️⃣ Add UP/DOWN counts per NBR
    const withStatusCounts = await Promise.all(
      paginated.map(async (row) => {
        const upCount = await IptCustomer.count({
          include: [
            {
              model: IptCustomerInfo,
              where: { nbr: row.nbr },
            },
          ],
          where: { operationalStatus: "up" },
        });

        const downCount = await IptCustomer.count({
          include: [
            {
              model: IptCustomerInfo,
              where: { nbr: row.nbr },
            },
          ],
          where: { operationalStatus: "down" },
        });

        return {
          ...row,
          up_customers: upCount,
          down_customers: downCount,
        };
      })
    );

    res.status(200).json({
      data: withStatusCounts,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("getNbrSummary error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Note: Duplicate getIptCustomerById removed - using the one at the top of the file

