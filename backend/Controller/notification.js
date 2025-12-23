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

    // Check current status for each customer
    let notificationsCreated = 0;

    for (const [key, customer] of customerMap) {
      let currentStatus = "unknown";
      
      // Get current status based on customer type
      if (customer.customerType === "DIA") {
        const diaCustomer = await db.diacustomers.findOne({
          where: { id: customer.customerId },
        });
        currentStatus = diaCustomer?.operationalStatus || "unknown";
      } else if (customer.customerType === "IPT") {
        const iptCustomer = await db.iptcustomers.findOne({
          where: { id: customer.customerId },
        });
        currentStatus = iptCustomer?.operationalStatus || "unknown";
      } else if (customer.customerType === "Shared") {
        const sharedCustomer = await db.sharedcustomers.findOne({
          where: { id: customer.customerId },
        });
        currentStatus = sharedCustomer?.operationalStatus || "unknown";
      }

      // Check if we need to notify (status is down)
      if (currentStatus === "down") {
        // Check if we already sent a notification for this customer being down recently (within last hour)
        const recentNotification = await Notification.findOne({
          where: {
            customerId: customer.customerId,
            customerType: customer.customerType,
            currentStatus: "down",
            createdAt: {
              [Op.gte]: new Date(Date.now() - 60 * 60 * 1000), // Last hour
            },
          },
        });

        if (!recentNotification) {
          // Create notifications for all users watching this customer
          const notifications = customer.userIds.map((userId) => ({
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
          }));

          await Notification.bulkCreate(notifications);
          notificationsCreated += notifications.length;
        }
      }
    }

    res.status(200).json({
      message: `Checked ${customerMap.size} customers, created ${notificationsCreated} notifications`,
      customersChecked: customerMap.size,
      notificationsCreated,
    });
  } catch (error) {
    console.error("Error in checkAndNotify:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

