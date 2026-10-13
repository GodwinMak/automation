const db = require("../Models");
const { Op } = require("sequelize");
const {
  WINDOW_MINUTES,
  THRESHOLD_CUSTOMERS,
  reconcileDownMembersAgainstLiveStatus,
  refreshIncidentCounts,
} = require("../utils/fiberCutDetector");

const MassOutageIncident = db.massOutageIncidents;
const MassOutageIncidentCustomer = db.massOutageIncidentCustomers;
const Favorites = db.favorites;

const mapFavoriteTypeToChurnType = (type) => {
  if (!type) return null;
  if (type === "Shared") return "SHARED";
  return type;
};

// Restrict customer_relation users to members belonging to their watchlist.
const buildWatchlistSetForUser = async (user) => {
  if (!user || user.role !== "customer_relation") return null;

  const favorites = await Favorites.findAll({
    where: { userId: user.id },
    attributes: ["interface", "customerType"],
    raw: true,
  });

  const set = new Set();
  for (const f of favorites) {
    const mappedType = mapFavoriteTypeToChurnType(f.customerType);
    if (!mappedType || !f.interface) continue;
    set.add(`${mappedType}:${f.interface}`);
  }
  return set;
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
};

const serializeIncident = (incident, now) => {
  const startedAt = new Date(incident.startedAt);
  const elapsedSeconds =
    incident.status === "open"
      ? Math.floor((now - startedAt) / 1000)
      : incident.totalDurationSeconds;

  return {
    id: incident.id,
    scope: incident.scope,
    nbr: incident.nbr,
    status: incident.status,
    startedAt: incident.startedAt,
    detectedAt: incident.detectedAt,
    resolvedAt: incident.resolvedAt,
    closedAt: incident.closedAt,
    closedByName: incident.closedByName,
    closeComment: incident.closeComment,
    customerCount: incident.customerCount,
    restoredCount: incident.restoredCount,
    stillDownCount: incident.customerCount - incident.restoredCount,
    durationSeconds: elapsedSeconds,
    durationFormatted: formatDuration(elapsedSeconds),
  };
};

const buildServiceBreakdown = (members) => {
  const ftthMembers = members.filter((m) => m.customerType === "FTTH");
  const nonFtthMembers = members.filter((m) => m.customerType !== "FTTH");
  const ftthRestored = ftthMembers.filter((m) => m.status === "restored").length;
  const nonFtthRestored = nonFtthMembers.filter((m) => m.status === "restored").length;

  return {
    ftth: {
      customerCount: ftthMembers.length,
      restoredCount: ftthRestored,
      stillDownCount: ftthMembers.length - ftthRestored,
    },
    nonFtth: {
      customerCount: nonFtthMembers.length,
      restoredCount: nonFtthRestored,
      stillDownCount: nonFtthMembers.length - nonFtthRestored,
    },
  };
};

/**
 * List mass-outage / fiber-cut incidents.
 */
exports.getIncidents = async (req, res) => {
  try {
    const { status, scope, page = 1, pageSize = 20, nbr } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const where = {};
    if (status && status !== "all") where.status = status;
    if (scope) where.scope = scope;
    if (nbr) where.nbr = { [Op.like]: `%${nbr}%` };

    const watchlistSet = await buildWatchlistSetForUser(req.user);
    if (watchlistSet && watchlistSet.size === 0) {
      return res.json({ data: [], totalItems: 0, totalPages: 0, currentPage: parseInt(page) });
    }

    let incidentIds = null;
    if (watchlistSet) {
      const visibleMembers = await MassOutageIncidentCustomer.findAll({
        attributes: ["incidentId", "customerType", "interface"],
        raw: true,
      });
      const ids = new Set();
      for (const m of visibleMembers) {
        if (watchlistSet.has(`${m.customerType}:${m.interface}`)) ids.add(m.incidentId);
      }
      incidentIds = [...ids];
      if (!incidentIds.length) {
        return res.json({ data: [], totalItems: 0, totalPages: 0, currentPage: parseInt(page) });
      }
      where.id = { [Op.in]: incidentIds };
    }

    const { count, rows } = await MassOutageIncident.findAndCountAll({
      where,
      order: [["detectedAt", "DESC"]],
      offset,
      limit: parseInt(pageSize),
    });

    const incidentIdList = rows.map((r) => r.id);
    const members = incidentIdList.length
      ? await MassOutageIncidentCustomer.findAll({
          where: { incidentId: { [Op.in]: incidentIdList } },
          attributes: ["incidentId", "customerType", "status"],
          raw: true,
        })
      : [];

    const membersByIncident = new Map();
    for (const m of members) {
      if (!membersByIncident.has(m.incidentId)) membersByIncident.set(m.incidentId, []);
      membersByIncident.get(m.incidentId).push(m);
    }

    const now = new Date();
    res.json({
      data: rows.map((r) => {
        const base = serializeIncident(r, now);
        const serviceBreakdown = buildServiceBreakdown(membersByIncident.get(r.id) || []);
        return {
          ...base,
          serviceBreakdown,
        };
      }),
      totalItems: count,
      totalPages: Math.ceil(count / parseInt(pageSize)),
      currentPage: parseInt(page),
      config: { windowMinutes: WINDOW_MINUTES, thresholdCustomers: THRESHOLD_CUSTOMERS },
    });
  } catch (error) {
    console.error("Error fetching fiber cut incidents:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get a single incident with the full per-customer breakdown — the
 * restoration report: who was impacted, when each came back, and the
 * total time from first impact to full restoration.
 */
exports.getIncidentDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const incident = await MassOutageIncident.findByPk(id, {
      include: [{ model: MassOutageIncidentCustomer, as: "members" }],
    });
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const watchlistSet = await buildWatchlistSetForUser(req.user);
    let members = incident.members || [];
    if (watchlistSet) {
      members = members.filter((m) => watchlistSet.has(`${m.customerType}:${m.interface}`));
      if (!members.length) return res.status(404).json({ error: "Incident not found" });
    }

    const now = new Date();

    // Cross-check any still-"down" member against their live status before
    // responding — catches a missed up-transition immediately instead of
    // waiting for the next cron cycle to self-heal it.
    if (incident.status === "open") {
      const stillDown = members.filter((m) => m.status === "down");
      const touched = await reconcileDownMembersAgainstLiveStatus(stillDown, now);
      if (touched.size) {
        await refreshIncidentCounts(incident.id);
        await incident.reload();
      }
    }

    const memberData = members
      .map((m) => {
        const downAt = new Date(m.downAt);
        const downtimeSeconds =
          m.status === "restored" ? m.downtimeSeconds : Math.floor((now - downAt) / 1000);
        return {
          id: m.id,
          customerType: m.customerType,
          interface: m.interface,
          customerName: m.customerName,
          cid: m.cid,
          nbr: m.nbr,
          switchName: m.switchName,
          status: m.status,
          downAt: m.downAt,
          restoredAt: m.restoredAt,
          downtimeSeconds,
          downtimeFormatted: formatDuration(downtimeSeconds),
        };
      })
      .sort((a, b) => new Date(a.downAt) - new Date(b.downAt));

    const ftthMembers = memberData.filter((m) => m.customerType === "FTTH");
    const nonFtthMembers = memberData.filter((m) => m.customerType !== "FTTH");
    const serviceBreakdown = buildServiceBreakdown(memberData);

    res.json({
      ...serializeIncident(incident, now),
      customerCount: memberData.length,
      restoredCount: memberData.filter((m) => m.status === "restored").length,
      stillDownCount: memberData.filter((m) => m.status === "down").length,
      serviceBreakdown,
      groupedMembers: {
        ftth: ftthMembers,
        nonFtth: nonFtthMembers,
      },
      members: memberData,
    });
  } catch (error) {
    console.error("Error fetching fiber cut incident detail:", error);
    res.status(500).json({ error: error.message });
  }
};

// Shared close logic — used by the manual "Close" button below and by the
// 12h-stale-links escalation cron (cron/fiberCutStaleLinksEmail.js), which
// auto-closes an incident right after successfully emailing the
// responsible team about it.
const closeIncidentRecord = async (incident, { comment, closedByUserId = null, closedByName = null } = {}) => {
  const now = new Date();
  await incident.update({
    status: "closed",
    closedAt: now,
    closedByUserId,
    closedByName,
    closeComment: comment?.trim() || null,
    totalDurationSeconds: Math.floor((now - new Date(incident.startedAt)) / 1000),
  });
  return incident;
};
exports.closeIncidentRecord = closeIncidentRecord;

/**
 * Manually close an incident. Members left "down" are not force-restored —
 * a comment is required in that case to explain why the incident is being
 * closed while customers are still impacted.
 */
exports.closeIncident = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const incident = await MassOutageIncident.findByPk(id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });
    if (incident.status !== "open") {
      return res.status(400).json({ error: `Incident is already ${incident.status}` });
    }

    const stillDownCount = incident.customerCount - incident.restoredCount;
    if (stillDownCount > 0 && !comment?.trim()) {
      return res.status(400).json({
        error: `${stillDownCount} customer(s) are still down on this incident — a comment is required to close it`,
      });
    }

    await closeIncidentRecord(incident, {
      comment,
      closedByUserId: req.user?.id || null,
      closedByName: req.user?.fullName || req.user?.username || null,
    });

    res.json(serializeIncident(incident, new Date()));
  } catch (error) {
    console.error("Error closing fiber cut incident:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Top-level counts for banners/widgets elsewhere in the app.
 */
exports.getIncidentSummary = async (req, res) => {
  try {
    const watchlistSet = await buildWatchlistSetForUser(req.user);
    if (watchlistSet && watchlistSet.size === 0) {
      return res.json({ openIncidents: 0, customersImpacted: 0, customersStillDown: 0 });
    }

    const where = { status: "open" };
    let openIncidents = await MassOutageIncident.findAll({
      where,
      include: watchlistSet
        ? [{ model: MassOutageIncidentCustomer, as: "members" }]
        : [],
    });

    if (watchlistSet) {
      openIncidents = openIncidents.filter((incident) =>
        (incident.members || []).some((m) => watchlistSet.has(`${m.customerType}:${m.interface}`))
      );
    }

    const incidentIds = openIncidents.map((i) => i.id);
    const members = incidentIds.length
      ? await MassOutageIncidentCustomer.findAll({
          where: { incidentId: { [Op.in]: incidentIds } },
          attributes: ["customerType", "status"],
          raw: true,
        })
      : [];

    const customersImpacted = openIncidents.reduce((sum, i) => sum + i.customerCount, 0);
    const customersStillDown = openIncidents.reduce((sum, i) => sum + (i.customerCount - i.restoredCount), 0);
    const ftthImpacted = members.filter((m) => m.customerType === "FTTH").length;
    const ftthStillDown = members.filter((m) => m.customerType === "FTTH" && m.status === "down").length;
    const nonFtthImpacted = members.filter((m) => m.customerType !== "FTTH").length;
    const nonFtthStillDown = members.filter((m) => m.customerType !== "FTTH" && m.status === "down").length;

    res.json({
      openIncidents: openIncidents.length,
      customersImpacted,
      customersStillDown,
      serviceBreakdown: {
        ftth: {
          customerCount: ftthImpacted,
          stillDownCount: ftthStillDown,
        },
        nonFtth: {
          customerCount: nonFtthImpacted,
          stillDownCount: nonFtthStillDown,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching fiber cut incident summary:", error);
    res.status(500).json({ error: error.message });
  }
};
