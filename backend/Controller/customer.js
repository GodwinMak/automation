const db = require("../Models");
const Customer = db.customerinfos;
const ClientDb = db.client_dbs;
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
            "first_name"
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

// Update or create client_db for a DIA customer by customer info ID
exports.updateClientDbForDia = async (req, res) => {
  const { id } = req.params;
  const {
    email_address,
    phone_number,
    onnet_offnet,
    customer_name_pastel,
    area,
    first_name,
    special_comments,
    medium_details,
    revenue_head,
    provider,
    new_customer_type,
  } = req.body;

  try {
    const info = await db.customerinfos.findByPk(id);
    if (!info) return res.status(404).json({ message: 'DIA customer not found' });

    const cid = info.cid;
    if (!cid) return res.status(400).json({ message: 'CID not found for this DIA customer' });

    let record = await ClientDb.findOne({ where: { network_cid: cid } });
    if (record) {
      await record.update({
        email_address: email_address !== undefined ? email_address : record.email_address,
        phone_number: phone_number !== undefined ? phone_number : record.phone_number,
        onnet_offnet: onnet_offnet !== undefined ? onnet_offnet : record.onnet_offnet,
        customer_name_pastel: customer_name_pastel !== undefined ? customer_name_pastel : record.customer_name_pastel,
        area: area !== undefined ? area : record.area,
        first_name: first_name !== undefined ? first_name : record.first_name,
        special_comments: special_comments !== undefined ? special_comments : record.special_comments,
        medium_details: medium_details !== undefined ? medium_details : record.medium_details,
        revenue_head: revenue_head !== undefined ? revenue_head : record.revenue_head,
        provider: provider !== undefined ? provider : record.provider,
        new_customer_type: new_customer_type !== undefined ? new_customer_type : record.new_customer_type,
      });

      return res.status(200).json({ message: 'Client DB updated successfully', data: record });
    }

    record = await ClientDb.create({
      network_cid: cid,
      email_address,
      phone_number,
      onnet_offnet,
      customer_name_pastel,
      area,
      first_name,
      special_comments,
      medium_details,
      revenue_head,
      provider,
      new_customer_type,
    });

    return res.status(201).json({ message: 'Client DB created successfully', data: record });
  } catch (error) {
    console.error('Error updating client_db for DIA:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};
// Admin-only: flag/unflag a DIA customer as high profile
exports.markHighProfile = async (req, res) => {
  const { id } = req.params;
  const { isHighProfile } = req.body;

  try {
    const info = await Customer.findByPk(id);
    if (!info) return res.status(404).json({ message: "DIA customer not found" });

    await info.update({ isHighProfile: !!isHighProfile });
    return res.status(200).json({ message: "Updated successfully", data: info });
  } catch (error) {
    console.error("Error updating high-profile flag for DIA customer:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get single DIA customer by interface name
exports.getCustomerByInterface = async (req, res) => {
  const { interface: interfaceName } = req.params;

  try {
    const customer = await Customer.findOne({
      where: { interface: interfaceName },
      include: [
        {
          model: db.diacustomers,
          attributes: [
            "operationalStatus",
            "adminStatus",
            "switchName",
            "destination",
            "description",
          ],
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
            "first_name",
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
    console.error("Error fetching customer by interface:", error);
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
            "first_name",
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
    // Single query: GROUP BY nbr with conditional SUM for up/down counts
    // Uses SQL LIMIT/OFFSET for proper DB-level pagination (no more JS slicing all rows)
    const [results, totalCountResult] = await Promise.all([
      Customer.findAll({
        attributes: [
          "nbr",
          [Sequelize.fn("COUNT", Sequelize.col("customerinfo.id")), "total_customers"],
          [Sequelize.fn("SUM", Sequelize.col("customerinfo.downmbps")), "total_downmbps"],
          [
            Sequelize.fn(
              "SUM",
              Sequelize.literal(
                "CASE WHEN `diacustomer`.`operationalStatus` = 'up' THEN 1 ELSE 0 END"
              )
            ),
            "up_customers",
          ],
          [
            Sequelize.fn(
              "SUM",
              Sequelize.literal(
                "CASE WHEN `diacustomer`.`operationalStatus` = 'down' THEN 1 ELSE 0 END"
              )
            ),
            "down_customers",
          ],
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
        order: [["nbr", "ASC"]],
        limit: pageSize,
        offset,
        raw: true,
        subQuery: false,
      }),
      // Count total distinct NBR groups for pagination metadata
      Customer.count({
        distinct: true,
        col: "nbr",
        where: {
          nbr: { [Sequelize.Op.like]: `%${searchQuery}%` },
        },
      }),
    ]);

    const totalItems = totalCountResult;
    const totalPages = Math.ceil(totalItems / pageSize);

    res.status(200).json({
      data: results,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("getNbrSummary error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


