const db = require("../Models");
const Customer = db.customerinfos;
const Sequelize = db.Sequelize;

// Get single DIA customer by ID
exports.getCustomerById = async (req, res) => {
  const { id } = req.params;

  try {
    const customer = await Customer.findByPk(id, {
      include: [
        {
          model: db.diacustomers,
          attributes: ["operationalStatus", "adminStatus", "switchName", "destination", "description"],
        },
        {
          model: db.client_dbs,
          attributes: [
            "area",
            "email_address",
            "medium_details",
            "onnet_offnet",
            "customer_name_pastel",
            "phone_number",
            "network_cid",
            "provider",
          ],
          required: false,
          on: Sequelize.where(
            Sequelize.col("customerinfo.cid"),
            "=",
            Sequelize.col("client_db.network_cid")
          ),
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAllCustomers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 5;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const upgradeType = req.query.upgradeType && req.query.upgradeType !== "all" ? req.query.upgradeType : null;
  const nbrFilter = req.query.nbr || "";

  try {
    // Build where clause
    const whereClause = {
      customerName: {
        [db.Sequelize.Op.like]: `%${searchQuery}%`,
      },
      ...(upgradeType ? { upgrade_type: upgradeType } : {}),
    };

    // Add NBR filter if provided
    if (nbrFilter) {
      whereClause.nbr = {
        [db.Sequelize.Op.like]: `%${nbrFilter}%`,
      };
    }

    const { count, rows } = await Customer.findAndCountAll({
      offset,
      limit: pageSize,
      where: whereClause,
      include: [
        {
          model: db.diacustomers,
          attributes: ["operationalStatus", "switchName", "destination"],
          where:
            statusFilter && statusFilter !== "all"
              ? { operationalStatus: statusFilter }
              : undefined,
        },
        {
          model: db.client_dbs,
          attributes: [
            "area",
            "email_address",
            "medium_details",
            "onnet_offnet",
            "customer_name_pastel",
            "phone_number",
            "network_cid",
            "provider",
          ],
          required: false,
          on: Sequelize.where(
            Sequelize.col("customerinfo.cid"),
            "=",
            Sequelize.col("client_db.network_cid")
          ),
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


exports.getNbrSummary = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 5;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";

  try {
    // 1️⃣ First: Fetch all grouped NBR rows
    const results = await Customer.findAll({
      attributes: [
        "nbr",
        [Sequelize.fn("COUNT", Sequelize.col("customerinfo.id")), "total_customers"],
        [Sequelize.fn("SUM", Sequelize.col("customerinfo.downmbps")), "total_downmbps"],
      ],
      include: [
        {
          model: db.diacustomers,
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
        const upCount = await db.diacustomers.count({
          include: [
            {
              model: Customer,
              where: { nbr: row.nbr },
            },
          ],
          where: { operationalStatus: "up" },
        });

        const downCount = await db.diacustomers.count({
          include: [
            {
              model: Customer,
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


