"use strict";

const Announcement = require("../../models/Announcement");
const Notification = require("../../models/Notification");
const logger = require("../../utils/logger");
const { badRequest, notFound, serviceUnavailable } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { assertValidObjectId, isValidObjectId } = require("../../utils/objectId");
const { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_PAGE, AUDIENCE_ROLES } = require("../../config/announcements");
const { validateAnnouncementInput } = require("./announcementValidation");
const {
  deliverAnnouncement,
  refreshDeliveredAlerts,
  removeAlerts,
  rollBackCreate,
} = require("./announcementDelivery");

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const toAnnouncement = (row, { includeAdminFields = false } = {}) => {
  const item = {
    id: String(row._id),
    title: row.title,
    message: row.message,
    eventAt: new Date(row.eventAt).toISOString(),
    location: row.location,
    audience: row.audience ?? "Everyone",
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt),
  };

  if (!includeAdminFields) return item;

  return {
    ...item,
    isDraft: Boolean(row.isDraft),
    recipientCount: row.recipientCount ?? 0,
    postedBy: row.createdBy?.fullname ?? null,
  };
};

const notFoundError = () =>
  notFound("This announcement is no longer available.", ERROR_CODES.ANNOUNCEMENT_NOT_FOUND);

const loadForAdmin = async (id) => {
  const announcementId = assertValidObjectId(id, "announcement");
  const announcement = await Announcement.findById(announcementId);
  if (!announcement) throw notFoundError();
  return announcement;
};

const adminView = async (announcement) => {
  await announcement.populate("createdBy", "fullname");
  return toAnnouncement(announcement.toObject(), { includeAdminFields: true });
};

/**
 * Saves the announcement and, unless it is a draft, writes one inbox alert per
 * account in its audience. If the alerts cannot be written the announcement is
 * removed again, so an admin never sees "posted" for something nobody was told about.
 */
const createAnnouncement = async ({ input, adminId }) => {
  const values = validateAnnouncementInput(input);
  const announcement = await Announcement.create({ ...values, createdBy: adminId });

  if (!values.isDraft) {
    try {
      announcement.recipientCount = await deliverAnnouncement(announcement, adminId);
      await announcement.save();
    } catch (error) {
      logger.error("Failed to deliver announcement notifications", { errorName: error?.name });
      await rollBackCreate(announcement._id);
      throw serviceUnavailable(
        "The announcement could not be sent right now. Nothing was posted; please try again."
      );
    }
  }

  return adminView(announcement);
};

/**
 * Saves an edit. Posting a draft sends its alerts now; editing a posted
 * announcement updates the alerts already delivered instead of sending new ones.
 */
const updateAnnouncement = async ({ id, input, adminId }) => {
  const announcement = await loadForAdmin(id);
  const wasDraft = Boolean(announcement.isDraft);
  const values = validateAnnouncementInput(input, { current: announcement.toObject() });

  announcement.set(values);
  await announcement.save();

  if (wasDraft && !values.isDraft) {
    try {
      announcement.recipientCount = await deliverAnnouncement(announcement, adminId);
      await announcement.save();
    } catch (error) {
      logger.error("Failed to deliver announcement notifications", { errorName: error?.name });
      await Notification.deleteMany({ announcement: announcement._id }).catch(() => undefined);
      announcement.isDraft = true;
      await announcement.save();
      throw serviceUnavailable(
        "The announcement could not be sent right now. It is still saved as a draft; please try again."
      );
    }
  } else if (!values.isDraft) {
    await refreshDeliveredAlerts(announcement);
  }

  return adminView(announcement);
};

/** Removes the announcement and every inbox alert that points at it. */
const deleteAnnouncement = async (id) => {
  const announcement = await loadForAdmin(id);
  await Announcement.deleteOne({ _id: announcement._id });
  await removeAlerts(announcement._id);
  return { id: String(announcement._id), title: announcement.title };
};

const parseLimit = (raw) => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return ANNOUNCEMENT_PAGE.defaultLimit;
  return Math.min(parsed, ANNOUNCEMENT_PAGE.maxLimit);
};

const audiencesFor = (role) =>
  ANNOUNCEMENT_AUDIENCES.filter((audience) => AUDIENCE_ROLES[audience].includes(role));

/**
 * What a non-admin reader may see: posted, not ended, and meant for their role.
 * Rows written before audiences existed have no audience or end date, and
 * `$in: [null]` / `null` match a missing field, so they stay visible to everyone.
 */
const feedFilter = (role, now = new Date()) => ({
  isDraft: { $ne: true },
  audience: { $in: [...audiencesFor(role), null] },
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});

/** Newest first. The cursor is the last id served; ObjectIds sort by creation time. */
const listAnnouncements = async ({ query = {}, role = null, includeAdminFields = false } = {}) => {
  const limit = parseLimit(query.limit);
  const cursor = typeof query.cursor === "string" ? query.cursor : "";

  if (cursor && !isValidObjectId(cursor)) {
    throw badRequest("Invalid announcement cursor.", ERROR_CODES.INVALID_ID);
  }

  const clauses = [
    ...(cursor ? [{ _id: { $lt: cursor } }] : []),
    ...(includeAdminFields ? [] : [feedFilter(role)]),
  ];

  let finder = Announcement.find(clauses.length ? { $and: clauses } : {})
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
const getAnnouncement = async (id, role) => {
  const announcementId = assertValidObjectId(id, "announcement");
  const row = await Announcement.findOne({ $and: [{ _id: announcementId }, feedFilter(role)] }).lean();
  if (!row) throw notFoundError();
  return toAnnouncement(row);
};

module.exports = {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  validateAnnouncementInput,
  toAnnouncement,
};
