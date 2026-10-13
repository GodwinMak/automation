const db = require("../Models");
const Notification = db.notifications;
const Favorite = db.favorites;
const User = db.users;
const { Op } = db.Sequelize;
const { sendSms } = require("../utils/sms");

const toDistinctUserIds = (items) => {
  const ids = new Set();
  for (const item of items || []) {
    const id = typeof item === "string" ? item : item?.userId;
    if (id) ids.add(id);
  }
  return [...ids];
};

const getExistingUserIdSet = async (items) => {
  const ids = toDistinctUserIds(items);
  if (!ids.length) return new Set();

  const users = await User.findAll({
    where: { id: ids },
    attributes: ["id"],
    raw: true,
  });

  return new Set(users.map((u) => u.id));
};

/**
 * Get all notifications for a user
 */
exports.getUserNotifications = async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 20;
  const offset = (page - 1) * pageSize;
  const unreadOnly = req.query.unreadOnly === "true";

  try {
    const whereClause = { userId };
    if (unreadOnly) {
      whereClause.isRead = false;
    }

    const { count, rows } = await Notification.findAndCountAll({
      where: whereClause,
      offset,
      limit: pageSize,
      order: [["createdAt", "DESC"]],
    });

    const totalPages = Math.ceil(count / pageSize);

    res.status(200).json({
      notifications: rows,
      totalItems: count,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Get unread notification count for a user
 */
exports.getUnreadCount = async (req, res) => {
  const userId = req.user.id;

  try {
    const count = await Notification.count({
      where: {
        userId,
        isRead: false,
      },
    });

    res.status(200).json({ unreadCount: count });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Mark a notification as read
 */
exports.markAsRead = async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.params;

  try {
    const notification = await Notification.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await notification.update({
      isRead: true,
      readAt: new Date(),
    });

    res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Mark all notifications as read for a user
 */
exports.markAllAsRead = async (req, res) => {
  const userId = req.user.id;

  try {
    await Notification.update(
      { isRead: true, readAt: new Date() },
      { where: { userId, isRead: false } }
    );

    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete a notification
 */
exports.deleteNotification = async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.params;

  try {
    const notification = await Notification.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await notification.destroy();

    res.status(200).json({ message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Delete all notifications for a user
 */
exports.deleteAllNotifications = async (req, res) => {
  const userId = req.user.id;

  try {
    await Notification.destroy({
      where: { userId },
    });

    res.status(200).json({ message: "All notifications deleted" });
  } catch (error) {
    console.error("Error deleting all notifications:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/**
 * Create notification for users watching a customer when status changes
 * This is called internally when a customer status changes from up to down
 */
exports.createStatusChangeNotification = async (customerData) => {
  const {
    customerId,
    customerName,
    customerType,
    interface: customerInterface,
    cid,
    nbr,
    previousStatus,
    currentStatus,
  } = customerData;

  try {
    // Only notify on up<->down transitions (down, or recovery back to up)
    const isDown = previousStatus === "up" && currentStatus === "down";
    const isRecovery = previousStatus === "down" && currentStatus === "up";
    if (!isDown && !isRecovery) {
      return { created: 0 };
    }

    // FTTH status changes are handled by the dedicated ftthDailyChecker cron — skip here
    if (customerType === "FTTH") {
      return { created: 0 };
    }

    // customerId is only ever populated from a real customerinfos-style row
    // (see e.g. getDiaCustomerInfoMap in utils/statusTracker.js). L2VPN
    // circuits have no such row — a circuit spans multiple devices/hops,
    // not one customer-info record — so trackL2VPNCircuitStatusChanges
    // always passes customerId: null. There's currently no watchlist/
    // Favorites support for L2VPN circuits to match against anyway, so
    // there's nothing to notify — skip before customerId.toString() throws.
    if (!customerId) {
      return { created: 0 };
    }

    // Find all users who have this customer in their watchlist. A favorite
    // can have userId: null ("global" favorite, per the model comment) —
    // there's no one to notify or SMS for those, and Notification.userId is
    // NOT NULL, so they're filtered out here rather than left to fail
    // bulkCreate below.
    const allFavorites = await Favorite.findAll({
      where: {
        customerId: customerId.toString(),
        customerType,
      },
    });
    const favoritesWithUser = allFavorites.filter((fav) => fav.userId);
    const existingUserIds = await getExistingUserIdSet(favoritesWithUser);
    const favorites = favoritesWithUser.filter((fav) => existingUserIds.has(fav.userId));

    if (favorites.length === 0) {
      return { created: 0 };
    }

    const message = isDown
      ? `🔴 ${customerName} (${customerType}) went DOWN. Interface: ${customerInterface}, CID: ${cid || "N/A"}`
      : `✅ ${customerName} (${customerType}) is back UP. Interface: ${customerInterface}, CID: ${cid || "N/A"}`;

    // Create notifications for each user watching this customer
    const notifications = favorites.map((fav) => ({
      userId: fav.userId,
      customerId: customerId.toString(),
      customerName,
      customerType,
      interface: customerInterface,
      cid,
      nbr,
      previousStatus,
      currentStatus,
      message,
      notificationType: "status_change",
    }));

    await Notification.bulkCreate(notifications);

    // Emit notification to each user
    try {
      const { emitNotificationToUser } = require("../emitNotificationToUser");
      notifications.forEach((notif) => {
        emitNotificationToUser(notif.userId, notif);
      });
    } catch (e) {
      console.error("[NOTIFICATION] Error emitting socket notification:", e);
    }

    console.log(`[NOTIFICATION] Created ${notifications.length} notifications for ${customerName} ${isDown ? "going down" : "recovering"}`);

    // SMS to the subset of watchers who opted into SMS alerts for this
    // customer (Favorite.smsAlertsEnabled), on both down and recovery.
    try {
      const smsFavorites = favorites.filter((fav) => fav.smsAlertsEnabled);
      if (smsFavorites.length > 0) {
        const smsUsers = await User.findAll({
          where: {
            id: smsFavorites.map((fav) => fav.userId),
            isActive: true,
            phoneNumber: { [Op.ne]: null },
          },
          attributes: ["phoneNumber"],
          raw: true,
        });
        if (smsUsers.length > 0) {
          await sendSms(message, smsUsers.map((u) => u.phoneNumber));
        }
      }
    } catch (smsError) {
      console.error("[NOTIFICATION] Error sending customer watchlist SMS:", smsError.message);
    }

    return { created: notifications.length };
  } catch (error) {
    console.error("Error creating status change notifications:", error);
    return { created: 0, error: error.message };
  }
};

/**
 * Create in-app notifications for users watching an ISIS adjacent link
 * (isis_watchlist, matched by point_to_point_ip) when it goes down or
 * recovers. Unlike createStatusChangeNotification's SMS path (gated on the
 * canReceiveIsisSms/highTrafficSmsEnabled toggles), this in-app channel is
 * independent of those SMS preferences — it only honors isisWatchScope, via
 * getIsisAlertRecipients(..., { requireSmsOptIn: false }).
 */
exports.createIsisAlertNotification = async ({
  pointToPointIp,
  deviceName,
  neighborName,
  interfaceName,
  previousStatus,
  currentStatus,
  message,
}) => {
  try {
    const { getIsisAlertRecipients } = require("../utils/notificationRecipients");
    const { users } = await getIsisAlertRecipients(pointToPointIp, "link", {
      requireSmsOptIn: false,
    });

    if (users.length === 0) return { created: 0 };

    const customerId = pointToPointIp || `${deviceName}:${neighborName}:${interfaceName}`;
    const customerName = `${deviceName} x ${neighborName}`;

    const notifications = users.map((u) => ({
      userId: u.id,
      customerId,
      customerName,
      customerType: "ISIS",
      interface: interfaceName,
      cid: null,
      nbr: neighborName,
      previousStatus,
      currentStatus,
      message,
      notificationType: "status_change",
    }));

    await Notification.bulkCreate(notifications);

    try {
      const { emitNotificationToUser } = require("../emitNotificationToUser");
      notifications.forEach((notif) => {
        emitNotificationToUser(notif.userId, notif);
      });
    } catch (e) {
      console.error("[NOTIFICATION] Error emitting ISIS socket notification:", e);
    }

    console.log(`[NOTIFICATION] Created ${notifications.length} ISIS notifications for ${customerName}`);

    return { created: notifications.length };
  } catch (error) {
    console.error("Error creating ISIS alert notifications:", error);
    return { created: 0, error: error.message };
  }
};

/**
 * Check watchlist and create notifications for status changes
 * This should be called periodically or when status updates are detected
 */
exports.checkAndNotify = async (req, res) => {
  try {
    // Get all unique customers from favorites (watchlist)
    const favorites = await Favorite.findAll({
      attributes: ["customerId", "customerType", "customerName", "interface", "cid", "nbr", "userId"],
    });

    // Group by customer
    const customerMap = new Map();
    favorites.forEach((fav) => {
      const key = `${fav.customerType}-${fav.customerId}`;
      if (!customerMap.has(key)) {
        customerMap.set(key, {
          ...fav.dataValues,
          userIds: [fav.userId],
        });
      } else {
        customerMap.get(key).userIds.push(fav.userId);
      }
    });

    if (customerMap.size === 0) {
      return res.status(200).json({ message: "No watchlist customers to check", customersChecked: 0, notificationsCreated: 0 });
    }

    // Batch-load statuses for each customer type using IN queries (avoids N+1)
    const diaIds = [], iptIds = [], sharedIds = [];
    for (const [, customer] of customerMap) {
      if (customer.customerType === "DIA") diaIds.push(customer.customerId);
      else if (customer.customerType === "IPT") iptIds.push(customer.customerId);
      else if (customer.customerType === "Shared") sharedIds.push(customer.customerId);
    }

    const [diaRows, iptRows, sharedRows] = await Promise.all([
      diaIds.length
        ? db.diacustomers.findAll({ where: { id: diaIds }, attributes: ["id", "operationalStatus"], raw: true })
        : [],
      iptIds.length
        ? db.iptcustomers.findAll({ where: { id: iptIds }, attributes: ["id", "operationalStatus"], raw: true })
        : [],
      sharedIds.length
        ? db.sharedcustomers.findAll({ where: { id: sharedIds }, attributes: ["id", "operationalStatus"], raw: true })
        : [],
    ]);

    // Build status lookup map
    const statusMap = new Map();
    for (const r of diaRows) statusMap.set(`DIA-${r.id}`, r.operationalStatus);
    for (const r of iptRows) statusMap.set(`IPT-${r.id}`, r.operationalStatus);
    for (const r of sharedRows) statusMap.set(`Shared-${r.id}`, r.operationalStatus);

    // Find customers that are currently down
    const downCustomers = [];
    for (const [key, customer] of customerMap) {
      const status = statusMap.get(key) || "unknown";
      if (status === "down") {
        downCustomers.push(customer);
      }
    }

    if (downCustomers.length === 0) {
      return res.status(200).json({
        message: `Checked ${customerMap.size} customers, 0 are down`,
        customersChecked: customerMap.size,
        notificationsCreated: 0,
      });
    }

    // Single query: find which customers already have a recent (last hour) down notification
    const recentlySentIds = new Set();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentNotifications = await Notification.findAll({
      where: {
        customerId: downCustomers.map((c) => c.customerId),
        currentStatus: "down",
        createdAt: { [Op.gte]: oneHourAgo },
      },
      attributes: ["customerId", "customerType"],
      raw: true,
    });
    for (const n of recentNotifications) {
      recentlySentIds.add(`${n.customerType}-${n.customerId}`);
    }

    // Build notification batch for customers not recently notified
    const notifications = [];
    for (const customer of downCustomers) {
      const key = `${customer.customerType}-${customer.customerId}`;
      if (recentlySentIds.has(key)) continue;

      for (const userId of customer.userIds) {
        notifications.push({
          userId,
          customerId: customer.customerId,
          customerName: customer.customerName,
          customerType: customer.customerType,
          interface: customer.interface,
          cid: customer.cid,
          nbr: customer.nbr,
          previousStatus: "up",
          currentStatus: "down",
          message: `🔴 ${customer.customerName} (${customer.customerType}) is DOWN. Interface: ${customer.interface}, CID: ${customer.cid || "N/A"}`,
          notificationType: "status_change",
        });
      }
    }

    let insertedCount = 0;
    if (notifications.length > 0) {
      const existingUserIds = await getExistingUserIdSet(notifications.map((n) => n.userId));
      const safeNotifications = notifications.filter((n) => existingUserIds.has(n.userId));
      if (safeNotifications.length > 0) {
        await Notification.bulkCreate(safeNotifications);
        insertedCount = safeNotifications.length;
      }
    }

    res.status(200).json({
      message: `Checked ${customerMap.size} customers, created ${insertedCount} notifications`,
      customersChecked: customerMap.size,
      notificationsCreated: insertedCount,
    });
  } catch (error) {
    console.error("Error in checkAndNotify:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

