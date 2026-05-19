const db = require("../Models");
const { Op, fn, col, literal } = require("sequelize");

const StatusChangeHistory = db.statusChangeHistories;
const Favorites = db.favorites;

// Map favorite customerType (DIA, IPT, Shared) to churn types (DIA, IPT, SHARED)
const mapFavoriteTypeToChurnType = (type) => {
  if (!type) return null;
  if (type === "Shared") return "SHARED";
  return type;
};

// Build a where-clause restriction for a user's watchlist (favorites)
// so customer_relation sees only their own watchlist customers in churn views.
const buildWatchlistWhereForUser = async (user) => {
  if (!user || user.role !== "customer_relation") return null;

  const favorites = await Favorites.findAll({
    where: { userId: user.id },
    attributes: ["interface", "customerType"],
    raw: true,
  });

  if (!favorites.length) {
    // No watchlist entries -> no results
    return [];
  }

  const conditions = favorites
    .map((f) => {
      const mappedType = mapFavoriteTypeToChurnType(f.customerType);
      if (!mappedType || !f.interface) return null;
      return {
        interface: f.interface,
        customerType: mappedType,
      };
    })
    .filter(Boolean);

  return conditions;
};

/**
 * Get status change history with filtering and pagination
 */
exports.getStatusChanges = async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      customerType,
      interface: interfaceFilter,
      fromStatus,
      toStatus,
      startDate,
      endDate,
      search,
      nbr,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const whereClause = {};

    if (customerType) whereClause.customerType = customerType;
    if (interfaceFilter) whereClause.interface = { [Op.like]: `%${interfaceFilter}%` };
    if (fromStatus) whereClause.previousStatus = fromStatus;
    if (toStatus) whereClause.newStatus = toStatus;
    if (nbr) whereClause.nbr = { [Op.like]: `%${nbr}%` };

    if (startDate || endDate) {
      whereClause.changedAt = {};
      if (startDate) whereClause.changedAt[Op.gte] = new Date(startDate);
      if (endDate) whereClause.changedAt[Op.lte] = new Date(endDate);
    }

    if (search) {
      whereClause[Op.or] = [
        { customerName: { [Op.like]: `%${search}%` } },
        { interface: { [Op.like]: `%${search}%` } },
        { cid: { [Op.like]: `%${search}%` } },
      ];
    }

    // Restrict customer_relation to their watchlist
    if (req.user?.role === "customer_relation") {
      const watchlistConditions = await buildWatchlistWhereForUser(req.user);
      if (watchlistConditions === null || watchlistConditions.length === 0) {
        return res.json({
          data: [],
          totalItems: 0,
          totalPages: 0,
          currentPage: parseInt(page),
        });
      }

      whereClause[Op.and] = whereClause[Op.and] || [];
      whereClause[Op.and].push({ [Op.or]: watchlistConditions });
    }

    const { count, rows } = await StatusChangeHistory.findAndCountAll({
      where: whereClause,
      order: [["changedAt", "DESC"]],
      offset,
      limit: parseInt(pageSize),
    });

    res.json({
      data: rows,
      totalItems: count,
      totalPages: Math.ceil(count / parseInt(pageSize)),
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error("Error fetching status changes:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get customers with frequent status changes (unstable customers)
 * These are potential churn risks
 */
exports.getUnstableCustomers = async (req, res) => {
  try {
    const { days = 30, minChanges = 3, customerType } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const whereClause = {
      changedAt: { [Op.gte]: startDate },
    };
    if (customerType) whereClause.customerType = customerType;

    // Restrict customer_relation to their watchlist
    if (req.user?.role === "customer_relation") {
      const watchlistConditions = await buildWatchlistWhereForUser(req.user);
      if (watchlistConditions === null || watchlistConditions.length === 0) {
        return res.json({
          period: `Last ${days} days`,
          minChanges: parseInt(minChanges),
          data: [],
        });
      }

      whereClause[Op.and] = whereClause[Op.and] || [];
      whereClause[Op.and].push({ [Op.or]: watchlistConditions });
    }

    const results = await StatusChangeHistory.findAll({
      attributes: [
        "interface",
        "customerType",
        "customerName",
        "cid",
        "nbr",
        "switchName",
        [fn("COUNT", col("id")), "changeCount"],
        [fn("SUM", literal("CASE WHEN newStatus = 'down' THEN 1 ELSE 0 END")), "downCount"],
        [fn("SUM", literal("CASE WHEN newStatus = 'up' THEN 1 ELSE 0 END")), "upCount"],
        [fn("MAX", col("changedAt")), "lastChange"],
        [fn("AVG", col("durationInPreviousState")), "avgDowntimeSec"],
      ],
      where: whereClause,
      group: ["interface", "customerType", "customerName", "cid", "nbr", "switchName"],
      having: literal(`COUNT(id) >= ${parseInt(minChanges)}`),
      order: [[literal("changeCount"), "DESC"]],
      raw: true,
    });

    res.json({
      period: `Last ${days} days`,
      minChanges: parseInt(minChanges),
      data: results.map((r) => ({
        ...r,
        avgDowntimeFormatted: formatDuration(r.avgDowntimeSec),
        stabilityScore: calculateStabilityScore(r),
      })),
    });
  } catch (error) {
    console.error("Error fetching unstable customers:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get customers who have been down for extended periods (high churn risk)
 * This includes:
 * 1. Customers with tracked status changes showing them as down (verified against actual status)
 * 2. Customers currently down in main tables (even without tracking history)
 * 
 * IMPORTANT: We verify against the ACTUAL current status in main tables to avoid
 * showing customers as "down" when they're actually "up" (e.g., if "up" event wasn't tracked)
 */
exports.getExtendedDowntimeCustomers = async (req, res) => {
  try {
    const { customerType } = req.query;
    const now = new Date();
    let results = [];
    const seenInterfaces = new Set();

    // ========== STEP 1: Get ACTUAL current status from main tables ==========
    // This is the source of truth for current status
    const actualDownInterfaces = new Map(); // key: "TYPE:interface" -> { switchName, ... }

    const getActualDownFromTable = async (model, type) => {
      if (customerType && customerType !== type) return;
      
      const downCustomers = await model.findAll({
        where: { operationalStatus: "down" },
        attributes: ["interface", "switchName", "operationalStatus"],
        raw: true,
      });
      
      for (const c of downCustomers) {
        const key = `${type}:${c.interface}`;
        actualDownInterfaces.set(key, { ...c, customerType: type });
      }
    };

    await Promise.all([
      getActualDownFromTable(db.diacustomers, "DIA"),
      getActualDownFromTable(db.iptcustomers, "IPT"),
      getActualDownFromTable(db.sharedcustomers, "SHARED"),
      getActualDownFromTable(db.l3vpncustomers, "L3VPN"),
    ]);

    // FTTH uses 'status' instead of 'operationalStatus' and 'ip' as identifier
    if (!customerType || customerType === "FTTH") {
      const ftthDownRaw = await db.ftthcustomers.findAll({
        where: { status: "down" },
        attributes: ["ip", "pppoeusername", "ip_version"],
        raw: true,
      });
      for (const c of ftthDownRaw) {
        const key = `FTTH:${c.ip}`;
        actualDownInterfaces.set(key, {
          interface: c.ip,
          switchName: null,
          customerType: "FTTH",
          pppoeusername: c.pppoeusername,
          ip_version: c.ip_version,
        });
      }
    }

    console.log(`[Churn] Actual currently down interfaces: ${actualDownInterfaces.size}`);

    // ========== STEP 2: Get from Status Change History (with verification) ==========
    // Find customers whose LAST status change was to "down"
    // BUT only if they're ACTUALLY down in the main table
    const historyWhereClause = {};
    if (customerType) historyWhereClause.customerType = customerType;

    const allChanges = await StatusChangeHistory.findAll({
      where: historyWhereClause,
      order: [["changedAt", "DESC"]],
      raw: true,
    });

    // Group by interface and get the most recent status for each
    const latestStatusByInterface = new Map();
    for (const change of allChanges) {
      const key = `${change.customerType}:${change.interface}`;
      if (!latestStatusByInterface.has(key)) {
        latestStatusByInterface.set(key, change);
      }
    }

    // Filter to only those:
    // 1. Last recorded status was "down"
    // 2. ACTUALLY down in main table (verified)
    let trackedDownCount = 0;
    let skippedBecauseActuallyUp = 0;

    for (const [key, record] of latestStatusByInterface.entries()) {
      // Skip if last recorded status wasn't "down"
      if (record.newStatus !== "down") continue;

      // VERIFY: Check if actually down in main table
      if (!actualDownInterfaces.has(key)) {
        // History says down, but main table says up - skip this!
        skippedBecauseActuallyUp++;
        console.log(`[Churn] Skipping ${record.interface} (${record.customerType}): history says down, but actually UP`);
        continue;
      }

      const downSince = new Date(record.changedAt);
      const downtimeSeconds = Math.floor((now - downSince) / 1000);
      
      results.push({
        ...record,
        downSince,
        downtimeSeconds,
        downtimeFormatted: formatDuration(downtimeSeconds),
        churnRisk: calculateChurnRisk(downtimeSeconds),
        source: "tracked", // We know when it went down
      });
      seenInterfaces.add(key);
      trackedDownCount++;
    }

    console.log(`[Churn] Tracked down (verified): ${trackedDownCount}, Skipped (actually up): ${skippedBecauseActuallyUp}`);

    // ========== STEP 3: Get untracked customers from main tables ==========
    // Customers currently down but no tracking history
    // (e.g., were down before tracking started)

    const fetchUntrackedFromTable = async (model, infoModel, type) => {
      if (customerType && customerType !== type) return [];

      const untrackedDown = [];
      
      for (const [key, c] of actualDownInterfaces.entries()) {
        if (c.customerType !== type) continue;
        if (seenInterfaces.has(key)) continue; // Already in tracked results

        // Get customer info
        let customerInfo = {};
        if (infoModel) {
          const info = await infoModel.findOne({
            where: { interface: c.interface },
            attributes: ["customerName", "cid", "nbr"],
            raw: true,
          });
          if (info) customerInfo = info;
        }

        untrackedDown.push({
          interface: c.interface,
          customerType: type,
          switchName: c.switchName,
          customerName: customerInfo.customerName || null,
          cid: customerInfo.cid || null,
          nbr: customerInfo.nbr || null,
          previousStatus: "unknown",
          newStatus: "down",
          downSince: null, // Unknown - was down before tracking
          downtimeSeconds: null,
          downtimeFormatted: "Unknown (before tracking)",
          churnRisk: "unknown",
          source: "untracked", // Down since before tracking started
        });
        seenInterfaces.add(key);
      }
      return untrackedDown;
    };

    // Fetch untracked from all tables
    const diaDown = await fetchUntrackedFromTable(db.diacustomers, db.customerinfos, "DIA");
    const iptDown = await fetchUntrackedFromTable(db.iptcustomers, db.iptcustomerinfos, "IPT");
    const sharedDown = await fetchUntrackedFromTable(db.sharedcustomers, db.sharedcustomerinfos, "SHARED");
    const l3vpnDown = await fetchUntrackedFromTable(db.l3vpncustomers, db.l3vpncustomerinfos, "L3VPN");

    // FTTH untracked (ip is the identifier, pppoeusername is the customer name)
    const ftthDown = [];
    if (!customerType || customerType === "FTTH") {
      for (const [key, c] of actualDownInterfaces.entries()) {
        if (c.customerType !== "FTTH") continue;
        if (seenInterfaces.has(key)) continue;
        ftthDown.push({
          interface: c.interface,
          ip: c.interface,
          pppoeusername: c.pppoeusername || null,
          ip_version: c.ip_version || null,
          customerType: "FTTH",
          switchName: null,
          customerName: c.pppoeusername || null,
          cid: null,
          nbr: null,
          previousStatus: "unknown",
          newStatus: "down",
          status: "down",
          downSince: null,
          downtimeSeconds: null,
          downtimeFormatted: "Unknown (before tracking)",
          churnRisk: "unknown",
          source: "untracked",
        });
        seenInterfaces.add(key);
      }
    }

    results.push(...diaDown, ...iptDown, ...sharedDown, ...l3vpnDown, ...ftthDown);

    // If customer_relation, filter to their watchlist only
    if (req.user?.role === "customer_relation") {
      const watchlistConditions = await buildWatchlistWhereForUser(req.user);
      if (!watchlistConditions || watchlistConditions.length === 0) {
        return res.json({
          totalCurrentlyDown: 0,
          trackedCount: 0,
          untrackedCount: 0,
          skippedBecauseActuallyUp,
          data: [],
        });
      }

      const allowedSet = new Set(
        watchlistConditions.map((c) => `${c.customerType}:${c.interface}`)
      );

      results = results.filter((r) =>
        allowedSet.has(`${r.customerType}:${r.interface}`)
      );
    }

    // Sort: tracked (with known downtime) first by duration, then untracked
    results.sort((a, b) => {
      if (a.source === "tracked" && b.source === "untracked") return -1;
      if (a.source === "untracked" && b.source === "tracked") return 1;
      if (a.downtimeSeconds && b.downtimeSeconds) {
        return b.downtimeSeconds - a.downtimeSeconds;
      }
      return 0;
    });

    res.json({
      totalCurrentlyDown: results.length,
      trackedCount: trackedDownCount,
      untrackedCount: results.length - trackedDownCount,
      skippedBecauseActuallyUp, // For debugging
      data: results,
    });
  } catch (error) {
    console.error("Error fetching extended downtime customers:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get churn analysis summary statistics
 */
exports.getChurnSummary = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const baseWhere = { changedAt: { [Op.gte]: startDate } };

    // Restrict customer_relation to watchlist
    let restrictedWhere = baseWhere;
    if (req.user?.role === "customer_relation") {
      const watchlistConditions = await buildWatchlistWhereForUser(req.user);
      if (!watchlistConditions || watchlistConditions.length === 0) {
        return res.json({
          period: `Last ${days} days`,
          summary: {
            totalChanges: 0,
            uniqueCustomersAffected: 0,
            changesByType: [],
          },
          dailyTrend: [],
          mostAffectedNbrs: [],
        });
      }

      restrictedWhere = {
        [Op.and]: [
          baseWhere,
          { [Op.or]: watchlistConditions },
        ],
      };
    }

    // Total status changes
    const totalChanges = await StatusChangeHistory.count({
      where: restrictedWhere,
    });

    // Changes by type
    const changesByType = await StatusChangeHistory.findAll({
      attributes: [
        "customerType",
        [fn("COUNT", col("id")), "totalChanges"],
        [fn("SUM", literal("CASE WHEN newStatus = 'down' THEN 1 ELSE 0 END")), "wentDown"],
        [fn("SUM", literal("CASE WHEN newStatus = 'up' THEN 1 ELSE 0 END")), "cameUp"],
      ],
      where: restrictedWhere,
      group: ["customerType"],
      raw: true,
    });

    // Daily trend
    const dailyTrend = await StatusChangeHistory.findAll({
      attributes: [
        [fn("DATE", col("changedAt")), "date"],
        [fn("COUNT", col("id")), "changes"],
        [fn("SUM", literal("CASE WHEN newStatus = 'down' THEN 1 ELSE 0 END")), "downs"],
        [fn("SUM", literal("CASE WHEN newStatus = 'up' THEN 1 ELSE 0 END")), "ups"],
      ],
      where: restrictedWhere,
      group: [fn("DATE", col("changedAt"))],
      order: [[fn("DATE", col("changedAt")), "ASC"]],
      raw: true,
    });

    // Most affected NBRs
    const mostAffectedNbrs = await StatusChangeHistory.findAll({
      attributes: [
        "nbr",
        [fn("COUNT", col("id")), "changeCount"],
        [fn("COUNT", fn("DISTINCT", col("interface"))), "uniqueCustomers"],
      ],
      where: {
        ...restrictedWhere,
        nbr: { [Op.ne]: null, [Op.ne]: "" },
      },
      group: ["nbr"],
      order: [[literal("changeCount"), "DESC"]],
      limit: 10,
      raw: true,
    });

    // Unique customers affected
    const uniqueAffected = await StatusChangeHistory.count({
      distinct: true,
      col: "interface",
      where: restrictedWhere,
    });

    res.json({
      period: `Last ${days} days`,
      summary: {
        totalChanges,
        uniqueCustomersAffected: uniqueAffected,
        changesByType,
      },
      dailyTrend,
      mostAffectedNbrs,
    });
  } catch (error) {
    console.error("Error fetching churn summary:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get status change history for a specific customer
 */
exports.getCustomerHistory = async (req, res) => {
  try {
    const { interface: interfaceId, customerType } = req.params;
    const { limit = 50 } = req.query;

    const whereClause = { interface: interfaceId };
    if (customerType) whereClause.customerType = customerType;

    const history = await StatusChangeHistory.findAll({
      where: whereClause,
      order: [["changedAt", "DESC"]],
      limit: parseInt(limit),
    });

    // Calculate statistics
    const stats = await StatusChangeHistory.findOne({
      attributes: [
        [fn("COUNT", col("id")), "totalChanges"],
        [fn("SUM", literal("CASE WHEN newStatus = 'down' THEN 1 ELSE 0 END")), "totalDowns"],
        [fn("AVG", literal("CASE WHEN previousStatus = 'down' THEN durationInPreviousState ELSE NULL END")), "avgDowntimeSec"],
        [fn("MAX", literal("CASE WHEN previousStatus = 'down' THEN durationInPreviousState ELSE 0 END")), "maxDowntimeSec"],
      ],
      where: whereClause,
      raw: true,
    });

    res.json({
      interface: interfaceId,
      history,
      stats: {
        ...stats,
        avgDowntimeFormatted: formatDuration(stats?.avgDowntimeSec || 0),
        maxDowntimeFormatted: formatDuration(stats?.maxDowntimeSec || 0),
      },
    });
  } catch (error) {
    console.error("Error fetching customer history:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get hourly/daily pattern analysis
 */
exports.getPatternAnalysis = async (req, res) => {
  try {
    const { days = 30, customerType } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const whereClause = { changedAt: { [Op.gte]: startDate } };
    if (customerType) whereClause.customerType = customerType;

    // Hourly pattern
    const hourlyPattern = await StatusChangeHistory.findAll({
      attributes: [
        [fn("HOUR", col("changedAt")), "hour"],
        [fn("COUNT", col("id")), "changes"],
        [fn("SUM", literal("CASE WHEN newStatus = 'down' THEN 1 ELSE 0 END")), "downs"],
      ],
      where: whereClause,
      group: [fn("HOUR", col("changedAt"))],
      order: [[fn("HOUR", col("changedAt")), "ASC"]],
      raw: true,
    });

    // Day of week pattern
    const dayOfWeekPattern = await StatusChangeHistory.findAll({
      attributes: [
        [fn("DAYOFWEEK", col("changedAt")), "dayOfWeek"],
        [fn("COUNT", col("id")), "changes"],
        [fn("SUM", literal("CASE WHEN newStatus = 'down' THEN 1 ELSE 0 END")), "downs"],
      ],
      where: whereClause,
      group: [fn("DAYOFWEEK", col("changedAt"))],
      order: [[fn("DAYOFWEEK", col("changedAt")), "ASC"]],
      raw: true,
    });

    const dayNames = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    res.json({
      period: `Last ${days} days`,
      hourlyPattern: hourlyPattern.map((h) => ({
        ...h,
        hourFormatted: `${h.hour}:00`,
      })),
      dayOfWeekPattern: dayOfWeekPattern.map((d) => ({
        ...d,
        dayName: dayNames[d.dayOfWeek] || "Unknown",
      })),
    });
  } catch (error) {
    console.error("Error fetching pattern analysis:", error);
    res.status(500).json({ error: error.message });
  }
};

// Helper functions
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function calculateStabilityScore(record) {
  // Lower score = more unstable
  // Based on: number of changes, ratio of downs, average downtime
  const changeCount = parseInt(record.changeCount) || 0;
  const downCount = parseInt(record.downCount) || 0;
  const avgDowntime = parseFloat(record.avgDowntimeSec) || 0;

  let score = 100;
  score -= changeCount * 5; // Penalize frequent changes
  score -= (downCount / Math.max(changeCount, 1)) * 30; // Penalize high down ratio
  score -= Math.min(avgDowntime / 3600, 30); // Penalize long downtimes (max 30 points)

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Churn risk thresholds (in seconds)
const CHURN_THRESHOLDS = {
  LOW: 3600,           // 1 hour
  MEDIUM: 86400,       // 1 day
  HIGH: 259200,        // 3 days
  CRITICAL: 604800,    // 1 week
  CHURNED: 1209600,    // 2 weeks - likely cancelled/churned
};

function calculateChurnRisk(downtimeSeconds) {
  if (!downtimeSeconds || downtimeSeconds < 0) return "unknown";
  if (downtimeSeconds < CHURN_THRESHOLDS.LOW) return "low";           // < 1 hour
  if (downtimeSeconds < CHURN_THRESHOLDS.MEDIUM) return "medium";     // < 1 day
  if (downtimeSeconds < CHURN_THRESHOLDS.HIGH) return "high";         // < 3 days
  if (downtimeSeconds < CHURN_THRESHOLDS.CRITICAL) return "critical"; // < 1 week
  if (downtimeSeconds < CHURN_THRESHOLDS.CHURNED) return "critical";  // < 2 weeks
  return "churned"; // >= 2 weeks - customer has likely churned
}

