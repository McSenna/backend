"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");
const { createSystemLog } = require("../services/systemLogService");
const {
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
} = require("../services/announcement/announcementService");

exports.getAnnouncementById = asyncHandler(async (req, res) => {
  const announcement = await getAnnouncement(req.params.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Announcement loaded successfully.",
    announcement,
  });
});

exports.getAnnouncements = asyncHandler(async (req, res) => {
  const page = await listAnnouncements({ query: req.query });

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
    description: `Admin posted the announcement "${announcement.title}"`,
    resource: "Announcement",
    resourceId: announcement.id,
    metadata: {
      eventAt: announcement.eventAt,
      location: announcement.location,
      recipientCount: announcement.recipientCount,
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Announcement posted.",
    announcement,
  });
});
