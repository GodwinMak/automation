/**
 * Status Change Tracker Utility
 * Shared helper for tracking status changes across DIA, IPT, and Shared customers
 */

const db = require("../Models");
const StatusChangeHistory = db.statusChangeHistories;

// In-memory cache to track last known status and timestamp per interface
const statusCache = {
  DIA: new Map(),
  IPT: new Map(),
  SHARED: new Map(),
};

// Off-hours configuration (22:00 - 04:00)
// DIA and SHARED customers are home/office customers who are likely sleeping/out of office
const OFF_HOURS_START = 22; // 10 PM
const OFF_HOURS_END = 4;    // 4 AM

/**
 * Check if current time is within off-hours (22:00 - 04:00)
 * @returns {boolean} true if within off-hours
 */
const isOffHours = () => {
  const now = new Date();
  const hour = now.getHours();
  // Off-hours: 22:00 (10 PM) to 04:00 (4 AM)
  // This means hour >= 22 OR hour < 4
  return hour >= OFF_HOURS_START || hour < OFF_HOURS_END;
};

/**
 * Check if status change tracking should be skipped for this customer type
 * DIA and SHARED customers are skipped during off-hours (22:00 - 04:00)
 * IPT customers are always tracked (24/7)
 * @param {string} customerType - DIA, IPT, or SHARED
 * @returns {boolean} true if tracking should be skipped
 */
const shouldSkipTracking = (customerType) => {
  // IPT customers are always tracked (enterprise/business critical)
  if (customerType === "IPT") {
    return false;
  }
  // DIA and SHARED are home/office customers - skip during off-hours
  return isOffHours();
};

/**
 * Initialize the cache from the database on startup
 * This ensures we have the last known status for each interface
 */
const initializeCache = async () => {
  try {
    // Get the most recent status change for each interface
    const recentChanges = await StatusChangeHistory.findAll({
      attributes: [
        "interface",
        "customerType",
        "newStatus",
        "changedAt",
      ],
      order: [["changedAt", "DESC"]],
    });

    // Populate cache
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

  // Check if we should skip tracking for this customer type during off-hours
  const skipTracking = shouldSkipTracking(customerType);
  const now = new Date();
  const currentHour = now.getHours();

  if (skipTracking) {
    console.log(`[StatusTracker] ⏰ Skipping ${customerType} tracking during off-hours (current hour: ${currentHour}:00)`);
    // Still update the cache so we don't get false changes when business hours resume
    for (const intf of interfaces) {
      const newStatus = intf.operationalStatus?.toLowerCase() || "unknown";
      cache.set(intf.interface, {
        status: newStatus,
        timestamp: now,
      });
    }
    return [];
  }

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
      await StatusChangeHistory.bulkCreate(changes);
      console.log(`[StatusTracker] Logged ${changes.length} status changes for ${customerType}`);
    } catch (error) {
      console.error(`[StatusTracker] Error logging changes:`, error.message);
    }
  }

  return changes;
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

module.exports = {
  initializeCache,
  trackStatusChanges,
  getDiaCustomerInfoMap,
  getIptCustomerInfoMap,
  getSharedCustomerInfoMap,
  statusCache,
  isOffHours,
  shouldSkipTracking,
  OFF_HOURS_START,
  OFF_HOURS_END,
};

