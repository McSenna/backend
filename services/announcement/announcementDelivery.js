"use strict";

const Announcement = require("../../models/Announcement");
const Notification = require("../../models/Notification");
const User = require("../../models/User");
const { SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");
const logger = require("../../utils/logger");
const { AUDIENCE_ROLES } = require("../../config/announcements");
const { truncateNotificationBody } = require("../appointment/notifications");

const LOCALE = "en-PH";

const formatEventAt = (eventAt) =>
  eventAt.toLocaleString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const alertBody = ({ eventAt, location, message }) =>
  truncateNotificationBody(`${formatEventAt(new Date(eventAt))} · ${location}. ${message}`);

// Every account in the audience that can currently sign in.
const loadRecipients = (audience, excludeUserId) =>
  User.find({
    _id: { $ne: excludeUserId },
    role: { $in: AUDIENCE_ROLES[audience] ?? AUDIENCE_ROLES.Everyone },
    $or: [
      { status: { $in: SIGN_IN_READY_STATUSES } },
      { status: { $in: [null, ""] }, verified: true },
    ],
  })
    .select("_id")
    .lean();

/** Writes one inbox alert per recipient and returns how many were sent. */
const deliverAnnouncement = async (announcement, authorId) => {
  const recipients = await loadRecipients(announcement.audience, authorId);
  const body = alertBody(announcement);

  if (recipients.length > 0) {
    await Notification.insertMany(
      recipients.map((user) => ({
        recipient: user._id,
        announcement: announcement._id,
        type: "announcement",
        title: announcement.title,
        body,
        tone: "info",
      })),
      { ordered: false }
    );
  }

  return recipients.length;
};

/** Keeps alerts already in inboxes in step with an edited announcement. */
const refreshDeliveredAlerts = async (announcement) => {
  try {
    await Notification.updateMany(
      { announcement: announcement._id },
      { $set: { title: announcement.title, body: alertBody(announcement) } }
    );
  } catch (error) {
    logger.error("Failed to refresh announcement alerts", { errorName: error?.name });
  }
};

const removeAlerts = async (announcementId) => {
  try {
    await Notification.deleteMany({ announcement: announcementId });
  } catch (error) {
    // The announcement itself is gone, and an orphaned alert opens as "no longer available".
    logger.error("Failed to remove announcement alerts", {
      announcementId: String(announcementId),
      errorName: error?.name,
    });
  }
};

const rollBackCreate = async (announcementId) => {
  try {
    await Notification.deleteMany({ announcement: announcementId });
    await Announcement.deleteOne({ _id: announcementId });
  } catch (error) {
    logger.error("Failed to roll back a partially delivered announcement", {
      announcementId: String(announcementId),
      errorName: error?.name,
    });
  }
};

module.exports = { deliverAnnouncement, refreshDeliveredAlerts, removeAlerts, rollBackCreate };
