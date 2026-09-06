"use strict";

const Notification = require("../models/Notification");

function mapToNotificationItem(n) {
  return {
    id: String(n._id),
    title: n.title,
    body: n.body,
    time: n.time ?? "",
    tone: n.tone,
    type: n.type ?? "system",
    isRead: Boolean(n.isRead),
  };
}

exports.getNotifications = async (req, res) => {
  try {
    const recipientId = req.user.userId;

    const notifications = await Notification.find({
      recipient: recipientId,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const unreadCount = await Notification.countDocuments({
      recipient: recipientId,
      isRead: false,
    });

    return res.json({
      success: true,
      unreadCount,
      notifications: notifications.map(mapToNotificationItem),
    });
  } catch (err) {
    console.error("getNotifications:", err);
    return res.status(500).json({ success: false, message: "Failed to load notifications" });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const recipientId = req.user.userId;
    const { id } = req.params;

    const updated = await Notification.findOneAndUpdate(
      { _id: id, recipient: recipientId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();

    return res.json({ success: true, updated: Boolean(updated) });
  } catch (err) {
    console.error("markNotificationRead:", err);
    return res.status(500).json({ success: false, message: "Failed to mark notification as read" });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const recipientId = req.user.userId;

    const { modifiedCount } = await Notification.updateMany(
      { recipient: recipientId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ success: true, modifiedCount });
  } catch (err) {
    console.error("markAllNotificationsRead:", err);
    return res.status(500).json({ success: false, message: "Failed to mark notifications as read" });
  }
};

