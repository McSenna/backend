"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");
const { createSystemLog } = require("../services/systemLogService");
const {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} = require("../services/announcement/announcementService");

exports.getAnnouncementById = asyncHandler(async (req, res) => {
  const announcement = await getAnnouncement(req.params.id, req.user?.role);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Announcement loaded successfully.",
    announcement,
  });
});

exports.getAnnouncements = asyncHandler(async (req, res) => {
  const page = await listAnnouncements({ query: req.query, role: req.user?.role });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Announcements loaded successfully.",
    ...page,
  });
});

exports.getAdminAnnouncements = asyncHandler(async (req, res) => {
  const page = await listAnnouncements({ query: req.query, includeAdminFields: true });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Announcements loaded successfully.",
    ...page,
  });
});

exports.createAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await createAnnouncement({ input: req.body, adminId: req.user.userId });

  await createSystemLog({
    req,
    action: "ANNOUNCEMENT_CREATED",
    role: req.user?.role,
    description: announcement.isDraft
      ? `Admin saved the draft announcement "${announcement.title}"`
      : `Admin posted the announcement "${announcement.title}"`,
    resource: "Announcement",
    resourceId: announcement.id,
    metadata: {
      eventAt: announcement.eventAt,
      location: announcement.location,
      audience: announcement.audience,
      isDraft: announcement.isDraft,
      recipientCount: announcement.recipientCount,
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: announcement.isDraft ? "Draft saved." : "Announcement posted.",
    announcement,
  });
});

exports.updateAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await updateAnnouncement({
    id: req.params.id,
    input: req.body,
    adminId: req.user.userId,
  });

  await createSystemLog({
    req,
    action: "ANNOUNCEMENT_UPDATED",
    role: req.user?.role,
    description: `Admin updated the announcement "${announcement.title}"`,
    resource: "Announcement",
    resourceId: announcement.id,
    metadata: { audience: announcement.audience, isDraft: announcement.isDraft },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Announcement updated.",
    announcement,
  });
});

exports.deleteAnnouncement = asyncHandler(async (req, res) => {
  const removed = await deleteAnnouncement(req.params.id);

  await createSystemLog({
    req,
    action: "ANNOUNCEMENT_DELETED",
    role: req.user?.role,
    description: `Admin deleted the announcement "${removed.title}"`,
    resource: "Announcement",
    resourceId: removed.id,
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Announcement deleted.",
    id: removed.id,
  });
});
