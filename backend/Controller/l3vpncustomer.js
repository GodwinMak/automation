const db = require("../Models");
const L3VPNCustomerInfo = db.l3vpncustomerinfos;
const L3VPNCustomer = db.l3vpncustomers;
const Sequelize = db.Sequelize;

exports.getAllL3VPNCustomers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 5;
  const offset = (page - 1) * pageSize;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const nbrFilter = req.query.nbr || "";

  try {
    const whereClause = {
      customerName: {
        [Sequelize.Op.like]: `%${searchQuery}%`,
      },
    };

    if (nbrFilter) {
      whereClause.nbr = {
        [Sequelize.Op.like]: `%${nbrFilter}%`,
      };
    }

    const { count, rows } = await L3VPNCustomerInfo.findAndCountAll({
      offset,
      limit: pageSize,
      where: whereClause,
      include: [
        {
          model: L3VPNCustomer,
          attributes: ["operationalStatus", "adminStatus", "switchName", "destination", "description"],
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
    console.error("Error fetching L3VPN customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getL3VPNCustomerById = async (req, res) => {
  const { id } = req.params;

  try {
    const customer = await L3VPNCustomerInfo.findByPk(id, {
      include: [
        {
          model: L3VPNCustomer,
          attributes: ["operationalStatus", "adminStatus", "switchName", "destination", "description"],
        },
      ],
    });

    if (!customer) {
      return res.status(404).json({ message: "L3VPN customer not found" });
    }

    res.status(200).json(customer);
  } catch (error) {
    console.error("Error fetching L3VPN customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
