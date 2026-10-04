"use strict";

const Announcement = require("../../models/Announcement");
const { AUDIENCE_ROLES } = require("../../config/announcements");
const { toAnnouncement } = require("../../services/announcement/announcementService");
const { broadcast } = require("../broadcast");
const { STAFF_ROLES, adminRoom, roleRoom } = require("../rooms");
const { splitChanges } = require("./shared");

const ALL_ROLES = ["resident", ...STAFF_ROLES];

/**
 * Mirrors feedFilter in announcementService: posted, not ended, and meant for
 * the role. Rows without an audience predate audiences and reach everyone.
 */
const feedRoles = (row, now = new Date()) => {
  if (row.isDraft) return [];
  if (row.expiresAt && new Date(row.expiresAt) <= now) return [];
  return row.audience ? AUDIENCE_ROLES[row.audience] ?? [] : ALL_ROLES;
};

const publishFeed = (row, action) => {
  const readers = feedRoles(row);
  const id = String(row._id);
  if (readers.length > 0) {
    broadcast("announcement", action, toAnnouncement(row), readers.map(roleRoom));
  }
  // Drafted again, ended, or narrowed to another audience: those feeds drop it.
  const lost = ALL_ROLES.filter((role) => !readers.includes(role));
  if (lost.length > 0) broadcast("announcement", "deleted", { id }, lost.map(roleRoom));
};

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    const rows = await Announcement.find({ _id: { $in: liveIds } }).populate("createdBy", "fullname").lean();
    for (const row of rows) {
      const action = actionOf(row._id);
      broadcast("adminAnnouncement", action, toAnnouncement(row, { includeAdminFields: true }), [adminRoom()]);
      publishFeed(row, action);
    }
  }

  for (const id of deletedIds) {
    broadcast("adminAnnouncement", "deleted", { id }, [adminRoom()]);
    broadcast("announcement", "deleted", { id }, ALL_ROLES.map(roleRoom));
  }
};

module.exports = { name: "announcements", model: Announcement, publish, feedRoles };
