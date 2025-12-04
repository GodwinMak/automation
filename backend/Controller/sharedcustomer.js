const db = require("../Models");
const SharedCustomerInfo = db.sharedcustomerinfos;
const SharedCustomer = db.sharedcustomers;
const Sequelize = db.Sequelize;

// Get single Shared customer by ID
exports.getSharedCustomerById = async (req, res) => {
  const { id } = req.params;

  try {
    const customer = await SharedCustomerInfo.findByPk(id, {
      include: [
        {
          model: SharedCustomer,
          attributes: ["operationalStatus", "adminStatus", "switchName", "description"],
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: "Shared Customer not found" });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching Shared customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAllSharedCustomers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const nbrFilter = req.query.nbr || "";

  try {
    // Build where clause for SharedCustomerInfo
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

    const { count, rows } = await SharedCustomerInfo.findAndCountAll({
      offset,
      limit: pageSize,
      where: whereClause,
      include: [
        {
          model: SharedCustomer,
          attributes: ["operationalStatus", "switchName", "adminStatus", "description"],
          where:
            statusFilter && statusFilter !== "all"
              ? { operationalStatus: statusFilter }
              : undefined,
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
    console.error("Error fetching Shared customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getNbrSummary = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";

  try {
    // Fetch all grouped NBR rows
    const results = await SharedCustomerInfo.findAll({
      attributes: [
        "nbr",
        [Sequelize.fn("COUNT", Sequelize.col("sharedcustomerinfo.id")), "total_customers"],
        [Sequelize.fn("SUM", Sequelize.col("sharedcustomerinfo.capacity")), "total_capacity"],
      ],
      include: [
        {
          model: SharedCustomer,
          attributes: [],
        },
      ],
      where: {
        nbr: { [Sequelize.Op.like]: `%${searchQuery}%` },
      },
      group: ["nbr"],
      raw: true,
    });

    const totalItems = results.length;
    const totalPages = Math.ceil(totalItems / pageSize);

    // Apply pagination AFTER grouping
    const paginated = results.slice(offset, offset + pageSize);

    // Add UP/DOWN counts per NBR
    const withStatusCounts = await Promise.all(
      paginated.map(async (row) => {
        const upCount = await SharedCustomer.count({
          include: [
            {
              model: SharedCustomerInfo,
              where: { nbr: row.nbr },
            },
          ],
          where: { operationalStatus: "up" },
        });

        const downCount = await SharedCustomer.count({
          include: [
            {
              model: SharedCustomerInfo,
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

exports.getSharedCustomerById = async (req, res) => {
  const { id } = req.params;

  try {
    const customer = await SharedCustomerInfo.findByPk(id, {
      include: [
        {
          model: SharedCustomer,
          attributes: ["operationalStatus", "switchName", "adminStatus", "description"],
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: "Shared Customer not found" });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching Shared customer by ID:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

