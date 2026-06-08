const db = require("../Models");
const Notification = db.notifications;
const Favorite = db.favorites;
const User = db.users;
const { Op } = db.Sequelize;

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
    // Only notify on up -> down transitions
    if (previousStatus !== "up" || currentStatus !== "down") {
      return { created: 0 };
    }

    // FTTH status changes are handled by the dedicated ftthDailyChecker cron — skip here
    if (customerType === "FTTH") {
      return { created: 0 };
    }

    // Find all users who have this customer in their watchlist
    const favorites = await Favorite.findAll({
      where: {
        customerId: customerId.toString(),
        customerType,
      },
    });

    if (favorites.length === 0) {
      return { created: 0 };
    }

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
      message: `🔴 ${customerName} (${customerType}) went DOWN. Interface: ${customerInterface}, CID: ${cid || "N/A"}`,
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

    console.log(`[NOTIFICATION] Created ${notifications.length} notifications for ${customerName} going down`);

    return { created: notifications.length };
  } catch (error) {
    console.error("Error creating status change notifications:", error);
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

    if (notifications.length > 0) {
      await Notification.bulkCreate(notifications);
    }

    res.status(200).json({
      message: `Checked ${customerMap.size} customers, created ${notifications.length} notifications`,
      customersChecked: customerMap.size,
      notificationsCreated: notifications.length,
    });
  } catch (error) {
    console.error("Error in checkAndNotify:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

