"use strict";

const Notification = require("../models/Notification");
const asyncHandler = require("../utils/asyncHandler");
const { assertValidObjectId } = require("../utils/objectId");
const { notFound } = require("../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../utils/errorCodes");

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

exports.getNotifications = asyncHandler(async (req, res) => {
  const recipientId = req.user.userId;

  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ recipient: recipientId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    Notification.countDocuments({ recipient: recipientId, isRead: false }),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notifications loaded successfully.",
    unreadCount,
    notifications: notifications.map(mapToNotificationItem),
  });
});

exports.markNotificationRead = asyncHandler(async (req, res) => {
  const recipientId = req.user.userId;
  const id = assertValidObjectId(req.params.id, "notification");

  const updated = await Notification.findOneAndUpdate(
    { _id: id, recipient: recipientId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  ).lean();

  if (!updated) {
    const exists = await Notification.exists({ _id: id, recipient: recipientId });
    if (!exists) {
      throw notFound(
        "This notification could not be found.",
        ERROR_CODES.NOTIFICATION_NOT_FOUND
      );
    }
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notification updated.",
    updated: Boolean(updated),
  });
});

exports.markAllNotificationsRead = asyncHandler(async (req, res) => {
  const recipientId = req.user.userId;

  const { modifiedCount } = await Notification.updateMany(
    { recipient: recipientId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "All notifications marked as read.",
    modifiedCount,
  });
});
