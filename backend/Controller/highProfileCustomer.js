const db = require("../Models");
const { Op } = db.Sequelize;

const TYPE_CONFIG = {
  DIA: { info: db.customerinfos, op: db.diacustomers },
  IPT: { info: db.iptcustomerinfos, op: db.iptcustomers },
  SHARED: { info: db.sharedcustomerinfos, op: db.sharedcustomers },
  L3VPN: { info: db.l3vpncustomerinfos, op: db.l3vpncustomers },
};

/**
 * GET /high-profile-customers?serviceType=&status=&search=&page=&pageSize=
 * Lists customers flagged isHighProfile=true across DIA/IPT/Shared/L3VPN,
 * merged into one paginated result tagged with customerType.
 */
exports.getHighProfileCustomers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  const searchQuery = req.query.search || "";
  const statusFilter = req.query.status || "";
  const serviceTypeFilter = (req.query.serviceType || "").toUpperCase();

  try {
    const typesToQuery = serviceTypeFilter && TYPE_CONFIG[serviceTypeFilter]
      ? [serviceTypeFilter]
      : Object.keys(TYPE_CONFIG);

    const results = await Promise.all(
      typesToQuery.map(async (type) => {
        const { info, op } = TYPE_CONFIG[type];
        const whereClause = { isHighProfile: true };
        if (searchQuery) {
          whereClause[Op.or] = [
            { customerName: { [Op.like]: `%${searchQuery}%` } },
            { cid: { [Op.like]: `%${searchQuery}%` } },
            { interface: { [Op.like]: `%${searchQuery}%` } },
          ];
        }

        const rows = await info.findAll({
          where: whereClause,
          include: [
            {
              model: op,
              attributes: ["operationalStatus", "switchName"],
              where:
                statusFilter && statusFilter !== "all"
                  ? { operationalStatus: statusFilter }
                  : undefined,
            },
          ],
        });

        return rows.map((r) => ({ ...r.toJSON(), customerType: type }));
      })
    );

    const merged = results.flat();
    const totalItems = merged.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const offset = (page - 1) * pageSize;
    const paginated = merged.slice(offset, offset + pageSize);

    res.status(200).json({
      customers: paginated,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching high profile customers:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
