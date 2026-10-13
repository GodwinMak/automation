/**
 * Status Change Tracker Utility
 * Shared helper for tracking status changes across DIA, IPT, and Shared customers
 */

const db = require("../Models");
const StatusChangeHistory = db.statusChangeHistories;
const StatusChangeHistoryFtth = db.statusChangeHistoriesFtth;
const { QueryTypes } = require("sequelize");
const { createStatusChangeNotification } = require("../Controller/notification");
const { emitNotificationToAll } = require("../emitNotificationToUser");
const { publish: publishToRedis } = require("./ioPublisher");
const { handleStatusChanges: handleMassOutageChanges } = require("./fiberCutDetector");

// In-memory cache to track last known status and timestamp per interface
const statusCache = {
  DIA: new Map(),
  IPT: new Map(),
  SHARED: new Map(),
  L3VPN: new Map(),
  FTTH: new Map(),
  L2VPN: new Map(),
};


/**
 * Initialize the cache from the database on startup
 * This ensures we have the last known status for each interface
 */
const initializeCache = async () => {
  try {
    const loadLatestRows = async (tableName) => {
      return db.sequelize.query(
        `SELECT s.interface, s.customerType, s.newStatus, s.changedAt
         FROM ${tableName} s
         INNER JOIN (
           SELECT interface, customerType, MAX(changedAt) AS maxChangedAt
           FROM ${tableName}
           GROUP BY interface, customerType
         ) latest
           ON s.interface = latest.interface
          AND s.customerType = latest.customerType
          AND s.changedAt = latest.maxChangedAt`,
        { type: QueryTypes.SELECT }
      );
    };

    const [mainChanges, ftthChanges] = await Promise.all([
      loadLatestRows("statusChangeHistories"),
      loadLatestRows("statusChangeHistories_ftth"),
    ]);

    const recentChanges = [...mainChanges, ...ftthChanges];

    for (const change of recentChanges) {
      const cache = statusCache[change.customerType];
      if (cache && !cache.has(change.interface)) {
        cache.set(change.interface, {
          status: change.newStatus,
          timestamp: change.changedAt,
        });
      }
    }

    console.log("[StatusTracker] Cache initialized:");
    console.log(`  - DIA: ${statusCache.DIA.size} interfaces`);
    console.log(`  - IPT: ${statusCache.IPT.size} interfaces`);
    console.log(`  - SHARED: ${statusCache.SHARED.size} interfaces`);
    console.log(`  - L3VPN: ${statusCache.L3VPN.size} interfaces`);
    console.log(`  - FTTH: ${statusCache.FTTH.size} interfaces`);
    console.log(`  - L2VPN: ${statusCache.L2VPN.size} interfaces`);
  } catch (error) {
    console.error("[StatusTracker] Error initializing cache:", error.message);
  }
};

/**
 * Track status changes for a batch of interfaces
 * @param {Array} interfaces - Array of interface objects with interface, operationalStatus, etc.
 * @param {string} customerType - Type of customer: DIA, IPT, or SHARED
 * @param {Object} customerInfoMap - Map of interface to customer info (name, cid, nbr)
 */
const trackStatusChanges = async (interfaces, customerType, customerInfoMap = {}) => {
  const cache = statusCache[customerType];
  if (!cache) {
    console.error(`[StatusTracker] Invalid customer type: ${customerType}`);
    return;
  }

  const now = new Date();

  const changes = [];

  for (const intf of interfaces) {
    const interfaceName = intf.interface;
    const newStatus = intf.operationalStatus?.toLowerCase() || "unknown";
    const cached = cache.get(interfaceName);
    const previousStatus = cached?.status || "unknown";
    const previousTimestamp = cached?.timestamp;

    // Only log if status actually changed (and not first time seeing it as "unknown")
    if (previousStatus !== newStatus && previousStatus !== "unknown") {
      // Calculate duration in previous state
      let durationInPreviousState = 0;
      if (previousTimestamp) {
        durationInPreviousState = Math.floor((now - new Date(previousTimestamp)) / 1000);
      }

      // Get customer info if available
      const customerInfo = customerInfoMap[interfaceName] || {};

      changes.push({
        customerId: customerInfo.id || null,
        customerType,
        interface: interfaceName,
        switchName: intf.switchName || null,
        customerName: customerInfo.customerName || null,
        cid: customerInfo.cid || null,
        nbr: customerInfo.nbr || null,
        previousStatus,
        newStatus,
        durationInPreviousState,
        changedAt: now,
        notes: `Status changed from ${previousStatus} to ${newStatus}`,
      });

      console.log(
        `[StatusTracker] ${customerType} ${interfaceName}: ${previousStatus} → ${newStatus} (was ${previousStatus} for ${formatDuration(durationInPreviousState)})`
      );
    }

    // Update cache
    cache.set(interfaceName, {
      status: newStatus,
      timestamp: now,
    });
  }

  // Bulk insert changes
  if (changes.length > 0) {
    try {
      const targetModel = customerType === "FTTH"
        ? StatusChangeHistoryFtth
        : StatusChangeHistory;
      await targetModel.bulkCreate(changes);
      console.log(`[StatusTracker] Logged ${changes.length} status changes for ${customerType}`);

      await notifyDownTransitions(changes);
      await notifyUpTransitions(changes);
      await notifyChurnRiskTransitions(changes);
    } catch (error) {
      console.error(`[StatusTracker] Error logging changes:`, error.message);
    }

    // Group simultaneous downs into fiber-cut / mass-outage incidents and
    // track member restorations. Never allowed to break status tracking.
    await handleMassOutageChanges(changes, now);
  }

  return changes;
};

/**
 * Send real-time + persisted notifications for up -> down transitions.
 * Shared by trackStatusChanges and any other code path that logs a forced
 * status change outside the normal per-type polling loop — e.g. the
 * ISIS-adjacency-driven "device fully isolated" detection in
 * fiberCutDetector.js, which forces customers down when their hosting
 * device can't be reached to poll them directly.
 */
const notifyDownTransitions = async (changes) => {
  for (const change of changes) {
    if (change.previousStatus !== "up" || change.newStatus !== "down") continue;
    try {
      // Broadcast real-time link-down alert for monitoring UIs.
      const realtimePayload = {
        customerId: change.customerId,
        customerName: change.customerName || "N/A",
        customerType: change.customerType,
        interface: change.interface,
        cid: change.cid || "N/A",
        nbr: change.nbr || "N/A",
        previousStatus: change.previousStatus,
        currentStatus: change.newStatus,
        switchName: change.switchName || null,
        notificationType: "status_change",
        message: `🔴 ${change.customerName || "Customer"} (${change.customerType}) went DOWN. Interface: ${change.interface}, CID: ${change.cid || "N/A"}`,
        timestamp: new Date().toISOString(),
      };

      const emittedCount = emitNotificationToAll(realtimePayload);
      // If this process has no connected sockets (cron worker / fork),
      // publish through Redis so the server cluster delivers it to clients.
      if (emittedCount === 0) {
        await publishToRedis("linkDownAlert", realtimePayload);
      }

      const result = await createStatusChangeNotification({
        customerId: change.customerId,
        customerName: change.customerName,
        customerType: change.customerType,
        interface: change.interface,
        cid: change.cid,
        nbr: change.nbr,
        previousStatus: change.previousStatus,
        currentStatus: change.newStatus,
      });
      if (result.created > 0) {
        console.log(`[StatusTracker] 🔔 Sent ${result.created} notifications for ${change.customerName} going down`);
      }
    } catch (notifyError) {
      console.error(`[StatusTracker] Error sending notification:`, notifyError.message);
    }
  }
};

/**
 * Send real-time + persisted notifications for down -> up (recovery)
 * transitions. Mirrors notifyDownTransitions but is deliberately a separate
 * function rather than a single bidirectional one: fiberCutDetector.js's
 * device-isolation path calls notifyDownTransitions directly to force
 * customers down when their hosting device is unreachable, and that forced
 * state has no legitimate "recovery" of its own — it shouldn't pick up
 * up-transition notifications just because this function exists.
 */
const notifyUpTransitions = async (changes) => {
  for (const change of changes) {
    if (change.previousStatus !== "down" || change.newStatus !== "up") continue;
    try {
      const realtimePayload = {
        customerId: change.customerId,
        customerName: change.customerName || "N/A",
        customerType: change.customerType,
        interface: change.interface,
        cid: change.cid || "N/A",
        nbr: change.nbr || "N/A",
        previousStatus: change.previousStatus,
        currentStatus: change.newStatus,
        switchName: change.switchName || null,
        notificationType: "status_change",
        message: `✅ ${change.customerName || "Customer"} (${change.customerType}) is back UP. Interface: ${change.interface}, CID: ${change.cid || "N/A"}`,
        timestamp: new Date().toISOString(),
      };

      const emittedCount = emitNotificationToAll(realtimePayload);
      if (emittedCount === 0) {
        await publishToRedis("linkDownAlert", realtimePayload);
      }

      const result = await createStatusChangeNotification({
        customerId: change.customerId,
        customerName: change.customerName,
        customerType: change.customerType,
        interface: change.interface,
        cid: change.cid,
        nbr: change.nbr,
        previousStatus: change.previousStatus,
        currentStatus: change.newStatus,
      });
      if (result.created > 0) {
        console.log(`[StatusTracker] 🔔 Sent ${result.created} notifications for ${change.customerName} recovering`);
      }
    } catch (notifyError) {
      console.error(`[StatusTracker] Error sending recovery notification:`, notifyError.message);
    }
  }
};

// L2VPN is the one customer type where Churn Analysis (getExtendedDowntimeCustomers
// in Controller/churnAnalysis.js) treats "mixed" — one leg of a multi-hop
// circuit down — as churn-worthy on its own, not just a full "down". Kept
// here so the push trigger below fires on exactly the same transitions
// churn considers "at risk", not a broader or narrower set.
const CHURN_RISK_STATUSES_BY_TYPE = {
  L2VPN: new Set(["down", "mixed"]),
};

const isChurnRiskTransition = (change) => {
  if (change.previousStatus !== "up") return false;
  const churnStatuses = CHURN_RISK_STATUSES_BY_TYPE[change.customerType] || new Set(["down"]);
  return churnStatuses.has(change.newStatus);
};

/**
 * Push notification (sound + OS-level alert, same Expo push mechanism as
 * cron/isisAdjacent.js's "ISIS Link Down" alert) for a customer newly
 * entering a status Churn Analysis itself would flag as at-risk. Deliberately
 * separate from notifyDownTransitions above — that one only ever fires on a
 * plain up->down transition and only sends the in-app/DB notification, never
 * a push; this fires on down for every type OR mixed for L2VPN specifically,
 * and only ever sends the push. No cooldown/dedup needed beyond what's
 * already built into trackStatusChanges: a "change" only exists here because
 * the in-memory cache detected an actual status flip, so this can never fire
 * twice for the same continuous down/mixed period.
 */
const notifyChurnRiskTransitions = async (changes) => {
  const churnChanges = changes.filter(isChurnRiskTransition);
  if (churnChanges.length === 0) return;

  try {
    const sendPushNotification = require("./sendPushNotification");
    const tokens = await sendPushNotification.getAllTokens();
    if (tokens.length === 0) return;

    for (const change of churnChanges) {
      const label = change.newStatus.toUpperCase();
      const message = `${change.customerName || change.interface} (${change.customerType}) is now ${label} — flagged in Churn Analysis.`;
      await sendPushNotification(tokens, "Churn Risk Alert", message);
    }
    console.log(`[StatusTracker] 🔔 Sent churn-risk push for ${churnChanges.length} transition(s)`);
  } catch (err) {
    console.error(`[StatusTracker] Error sending churn-risk push notifications:`, err.message);
  }
};

/**
 * Format duration in human-readable format
 */
const formatDuration = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

/**
 * Get customer info map for DIA customers
 */
const getDiaCustomerInfoMap = async () => {
  const customerInfoMap = {};
  try {
    const customers = await db.customerinfos.findAll({
      attributes: ["id", "interface", "customerName", "cid", "nbr"],
    });
    for (const c of customers) {
      customerInfoMap[c.interface] = {
        id: c.id,
        customerName: c.customerName,
        cid: c.cid,
        nbr: c.nbr,
      };
    }
  } catch (error) {
    console.error("[StatusTracker] Error fetching DIA customer info:", error.message);
  }
  return customerInfoMap;
};

/**
 * Get customer info map for IPT customers
 */
const getIptCustomerInfoMap = async () => {
  const customerInfoMap = {};
  try {
    const customers = await db.iptcustomerinfos.findAll({
      attributes: ["id", "interface", "customerName", "nbr"],
    });
    for (const c of customers) {
      customerInfoMap[c.interface] = {
        id: c.id,
        customerName: c.customerName,
        cid: null,
        nbr: c.nbr,
      };
    }
  } catch (error) {
    console.error("[StatusTracker] Error fetching IPT customer info:", error.message);
  }
  return customerInfoMap;
};

/**
 * Get customer info map for Shared customers
 */
const getSharedCustomerInfoMap = async () => {
  const customerInfoMap = {};
  try {
    const customers = await db.sharedcustomerinfos.findAll({
      attributes: ["id", "interface", "customerName", "cid", "nbr"],
    });
    for (const c of customers) {
      customerInfoMap[c.interface] = {
        id: c.id,
        customerName: c.customerName,
        cid: c.cid,
        nbr: c.nbr,
      };
    }
  } catch (error) {
    console.error("[StatusTracker] Error fetching Shared customer info:", error.message);
  }
  return customerInfoMap;
};

/**
 * Get customer info map for L3VPN customers
 */
const getL3vpnCustomerInfoMap = async () => {
  const customerInfoMap = {};
  try {
    const customers = await db.l3vpncustomerinfos.findAll({
      attributes: ["id", "interface", "customerName", "cid", "nbr"],
    });
    for (const c of customers) {
      customerInfoMap[c.interface] = {
        id: c.id,
        customerName: c.customerName,
        cid: c.cid,
        nbr: c.nbr,
      };
    }
  } catch (error) {
    console.error("[StatusTracker] Error fetching L3VPN customer info:", error.message);
  }
  return customerInfoMap;
};

module.exports = {
  initializeCache,
  trackStatusChanges,
  notifyDownTransitions,
  notifyUpTransitions,
  notifyChurnRiskTransitions,
  getDiaCustomerInfoMap,
  getIptCustomerInfoMap,
  getSharedCustomerInfoMap,
  getL3vpnCustomerInfoMap,
  statusCache,
};

