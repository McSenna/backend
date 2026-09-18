"use strict";

const Notification = require("../models/Notification");
const asyncHandler = require("../utils/asyncHandler");
const { assertValidObjectId } = require("../utils/objectId");
const { notFound } = require("../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../utils/errorCodes");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function mapToNotificationItem(n) {
  return {
    id: String(n._id),
    title: n.title,
    body: n.body,
    time: n.time ?? "",
    tone: n.tone,
    type: n.type ?? "system",
    isRead: Boolean(n.isRead),
    createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : null,
    appointmentId: n.appointment ? String(n.appointment) : null,
  };
}

function parseLimit(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Cursors are "<createdAt ISO>_<id>" so that notifications sharing the same
 * millisecond (fan-out writes) are never skipped or served twice.
 */
function buildCursorFilter(raw) {
  if (typeof raw !== "string" || !raw.includes("_")) return null;

  const separator = raw.lastIndexOf("_");
  const createdAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);

  if (Number.isNaN(createdAt.getTime())) return null;

  try {
    return {
      $or: [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: assertValidObjectId(id, "notification") } },
      ],
    };
  } catch {
    return null;
  }
}

const encodeCursor = (n) => `${new Date(n.createdAt).toISOString()}_${String(n._id)}`;

exports.getNotifications = asyncHandler(async (req, res) => {
  const recipientId = req.user.userId;
  const limit = parseLimit(req.query.limit);
  const cursorFilter = buildCursorFilter(req.query.cursor);

  const filter = cursorFilter
    ? { recipient: recipientId, ...cursorFilter }
    : { recipient: recipientId };

  const [rows, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(),
    Notification.countDocuments({ recipient: recipientId, isRead: false }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notifications loaded successfully.",
    unreadCount,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    notifications: page.map(mapToNotificationItem),
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

  const unreadCount = await Notification.countDocuments({
    recipient: recipientId,
    isRead: false,
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Notification updated.",
    updated: Boolean(updated),
    unreadCount,
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
    unreadCount: 0,
  });
});
