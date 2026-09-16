"use strict";

const Appointment = require("../models/Appointment");
const Notification = require("../models/Notification");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { notFound } = require("../utils/AppError");
const { HTTP_STATUS } = require("../utils/errorCodes");

const UPCOMING_STATUSES = ["pending", "confirmed", "rescheduled"];

const ATTENDED_STATUSES = ["confirmed", "rescheduled"];

const getResidentDashboard = asyncHandler(async (req, res) => {
  const residentId = req.user.userId;
  const now = new Date();

  const resident = await User.findById(residentId)
    .select("fullname email profilePhoto role")
    .lean();

  if (!resident) {
    throw notFound("Your resident profile could not be found.");
  }

  const ownedByResident = { resident: residentId };

  const [
    upcomingAppointments,
    completedAppointments,
    medicalRecords,
    unreadAnnouncements,
    nextAppointmentRow,
  ] = await Promise.all([
    Appointment.countDocuments({
      ...ownedByResident,
      status: { $in: UPCOMING_STATUSES },
      $or: [{ slotStart: null }, { slotStart: { $gte: now } }],
    }),

    Appointment.countDocuments({
      ...ownedByResident,
      status: { $in: ATTENDED_STATUSES },
      slotStart: { $ne: null, $lt: now },
    }),

    Appointment.countDocuments(ownedByResident),

    Notification.countDocuments({ recipient: residentId, isRead: false }),

    Appointment.findOne({
      ...ownedByResident,
      status: { $in: ATTENDED_STATUSES },
      slotStart: { $ne: null, $gte: now },
    })
      .sort({ slotStart: 1 })
      .select("consultationType status slotStart slotEnd assignedBy missionSchedule")
      .populate("assignedBy", "fullname role")
      .lean(),
  ]);

  const firstName = String(resident.fullname || "").trim().split(/\s+/)[0] || "";

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Dashboard loaded successfully.",
    dashboard: {
      resident: {
        id: String(resident._id),
        fullname: resident.fullname || "",
        firstName,
        profilePhoto: resident.profilePhoto || null,
      },
      statistics: {
        upcomingAppointments,
        completedAppointments,
        medicalRecords,
        unreadAnnouncements,
      },
      nextAppointment: nextAppointmentRow
        ? {
            id: String(nextAppointmentRow._id),
            consultationType: nextAppointmentRow.consultationType,
            status: nextAppointmentRow.status,
            slotStart: nextAppointmentRow.slotStart,
            slotEnd: nextAppointmentRow.slotEnd,
            assignedTo: nextAppointmentRow.assignedBy?.fullname || null,
          }
        : null,
    },
  });
});

module.exports = { getResidentDashboard, UPCOMING_STATUSES, ATTENDED_STATUSES };
