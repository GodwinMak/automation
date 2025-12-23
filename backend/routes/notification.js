const express = require("express");
const router = express.Router();
const {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  checkAndNotify,
} = require("../Controller/notification");
const { verifyToken } = require("../middleware/auth");

// Get all notifications for the logged-in user
router.get("/", verifyToken, getUserNotifications);

// Get unread notification count
router.get("/unread-count", verifyToken, getUnreadCount);

// Mark a specific notification as read
router.put("/:notificationId/read", verifyToken, markAsRead);

// Mark all notifications as read
router.put("/mark-all-read", verifyToken, markAllAsRead);

// Delete a specific notification
router.delete("/:notificationId", verifyToken, deleteNotification);

// Delete all notifications
router.delete("/", verifyToken, deleteAllNotifications);

// Admin: Trigger notification check for all watched customers
router.post("/check", verifyToken, checkAndNotify);

module.exports = router;

