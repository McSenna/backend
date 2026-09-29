"use strict";

const Announcement = require("../../models/Announcement");
const Notification = require("../../models/Notification");
const User = require("../../models/User");
const { SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");
const logger = require("../../utils/logger");
const { badRequest, notFound, serviceUnavailable } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { assertValidObjectId, isValidObjectId } = require("../../utils/objectId");
const { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_PAGE } = require("../../config/announcements");
const { truncateNotificationBody } = require("../appointment/notifications");

const LOCALE = "en-PH";
const DAY_MS = 24 * 60 * 60 * 1000;
// A full ISO-8601 timestamp; bare numbers or loose strings like "tomorrow" are rejected.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const lengthError = (label, value, min, max) => {
  if (!value) return `${label} is required.`;
  if (value.length < min) return `${label} must be at least ${min} characters.`;
  if (value.length > max) return `${label} must not exceed ${max} characters.`;
  return null;
};

// Date() rolls "02-30" over into March, so check the written parts are a real calendar time.
const isRealDateTime = (text) => {
  const [year, month, day, hour, minute] = text.match(/\d+/g).slice(0, 5).map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59;
};

const startOfToday = (now) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
};

const eventAtError = (raw, now) => {
  if (raw === undefined || raw === null || raw === "") return "Choose the date and time of the announcement.";
  if (typeof raw !== "string" || !ISO_DATE_TIME.test(raw.trim()) || !isRealDateTime(raw.trim())) {
    return "Enter a valid date and time.";
  }

  const eventAt = new Date(raw.trim());
  if (Number.isNaN(eventAt.getTime())) return "Enter a valid date and time.";
  if (eventAt < startOfToday(now)) return "The date cannot be in the past.";
  if (eventAt.getTime() - now.getTime() > ANNOUNCEMENT_LIMITS.maxDaysAhead * DAY_MS) {
    return `The date must be within the next ${ANNOUNCEMENT_LIMITS.maxDaysAhead} days.`;
  }
  return null;
};

/** Validates every field at once so the form can mark all problems together. */
const validateAnnouncementInput = (input, now = new Date()) => {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const L = ANNOUNCEMENT_LIMITS;

  const values = {
    title: asText(body.title),
    message: asText(body.message),
    location: asText(body.location),
  };

  const fieldErrors = {};
  const titleError = lengthError("Title", values.title, L.titleMin, L.titleMax);
  const messageError = lengthError("Message", values.message, L.messageMin, L.messageMax);
  const dateError = eventAtError(body.eventAt, now);
  const locationError = lengthError("Location", values.location, L.locationMin, L.locationMax);

  if (titleError) fieldErrors.title = titleError;
  if (messageError) fieldErrors.message = messageError;
  if (dateError) fieldErrors.eventAt = dateError;
  if (locationError) fieldErrors.location = locationError;

  const [firstError] = Object.values(fieldErrors);
  if (firstError) {
    throw badRequest(firstError, ERROR_CODES.VALIDATION_ERROR, { fieldErrors });
  }

  return { ...values, eventAt: new Date(body.eventAt.trim()) };
};

const formatEventAt = (eventAt) =>
  eventAt.toLocaleString(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Every account that can currently sign in, staff included.
const loadRecipients = (excludeUserId) =>
  User.find({
    _id: { $ne: excludeUserId },
    $or: [
      { status: { $in: SIGN_IN_READY_STATUSES } },
      { status: { $in: [null, ""] }, verified: true },
    ],
  })
    .select("_id")
    .lean();

const toAnnouncement = (row, { includeAdminFields = false } = {}) => {
  const item = {
    id: String(row._id),
    title: row.title,
    message: row.message,
    eventAt: new Date(row.eventAt).toISOString(),
    location: row.location,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };

  if (!includeAdminFields) return item;

  return {
    ...item,
    recipientCount: row.recipientCount ?? 0,
    postedBy: row.createdBy?.fullname ?? null,
  };
};

const rollBack = async (announcementId) => {
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

/**
 * Saves the announcement and writes one inbox alert per signed-in-ready account.
 * If the alerts cannot be written the announcement is removed again, so an admin
 * never sees "posted" for something nobody was told about.
 */
const createAnnouncement = async ({ input, adminId }) => {
  const values = validateAnnouncementInput(input);

  const announcement = await Announcement.create({ ...values, createdBy: adminId });

  try {
    const recipients = await loadRecipients(adminId);
    const body = truncateNotificationBody(
      `${formatEventAt(values.eventAt)} · ${values.location}. ${values.message}`
    );

    if (recipients.length > 0) {
      await Notification.insertMany(
        recipients.map((user) => ({
          recipient: user._id,
          announcement: announcement._id,
          type: "announcement",
          title: values.title,
          body,
          tone: "info",
        })),
        { ordered: false }
      );
    }

    announcement.recipientCount = recipients.length;
    await announcement.save();
  } catch (error) {
    logger.error("Failed to deliver announcement notifications", { errorName: error?.name });
    await rollBack(announcement._id);
    throw serviceUnavailable(
      "The announcement could not be sent right now. Nothing was posted; please try again."
    );
  }

  await announcement.populate("createdBy", "fullname");
  return toAnnouncement(announcement.toObject(), { includeAdminFields: true });
};

const parseLimit = (raw) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return ANNOUNCEMENT_PAGE.defaultLimit;
  return Math.min(parsed, ANNOUNCEMENT_PAGE.maxLimit);
};

/** Newest first. The cursor is the last id served; ObjectIds sort by creation time. */
const listAnnouncements = async ({ query = {}, includeAdminFields = false } = {}) => {
  const limit = parseLimit(query.limit);
  const cursor = typeof query.cursor === "string" ? query.cursor : "";

  if (cursor && !isValidObjectId(cursor)) {
    throw badRequest("Invalid announcement cursor.", ERROR_CODES.INVALID_ID);
  }

  let finder = Announcement.find(cursor ? { _id: { $lt: cursor } } : {})
    .sort({ _id: -1 })
    .limit(limit + 1);

  if (includeAdminFields) finder = finder.populate("createdBy", "fullname");

  const rows = await finder.lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    announcements: page.map((row) => toAnnouncement(row, { includeAdminFields })),
    hasMore,
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  };
};

/** One announcement from the shared feed, as a notification opens it. */
const getAnnouncement = async (id) => {
  const announcementId = assertValidObjectId(id, "announcement");
  const row = await Announcement.findById(announcementId).lean();

  if (!row) {
    throw notFound(
      "This announcement is no longer available.",
      ERROR_CODES.ANNOUNCEMENT_NOT_FOUND
    );
  }

  return toAnnouncement(row);
};

module.exports = { createAnnouncement, getAnnouncement, listAnnouncements, validateAnnouncementInput };
