"use strict";

const Appointment = require("../models/Appointment");
const Notification = require("../models/Notification");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { notFound } = require("../utils/AppError");
const { HTTP_STATUS } = require("../utils/errorCodes");

/**
 * Statuses that mean the visit is still ahead of the resident.
 *
 * `pending` counts: the appointment is queued and awaiting a slot, which is
 * upcoming from the resident's point of view even though no date exists yet.
 * `declined` never counts, and there is no `completed` status in the schema —
 * a finished visit is a confirmed one whose slot has passed.
 */
const UPCOMING_STATUSES = ["pending", "confirmed", "rescheduled"];

/** Statuses that can represent an attended visit once the slot is in the past. */
const ATTENDED_STATUSES = ["confirmed", "rescheduled"];

/**
 * Everything the Resident Dashboard shows, for the authenticated resident only.
 *
 * One endpoint rather than five: the four cards and the next appointment are
 * counts over the same two collections, and doing them here keeps the phone
 * from downloading every appointment just to call `.length` on it.
 *
 * The resident is taken from `req.user.userId`, which the auth middleware
 * derives from the verified JWT. No identifier is read from the query string or
 * body, so there is no parameter a caller could change to reach another
 * resident's data.
 */
const getResidentDashboard = asyncHandler(async (req, res) => {
  const residentId = req.user.userId;
  const now = new Date();

  const resident = await User.findById(residentId)
    .select("fullname email profilePhoto role")
    .lean();

  if (!resident) {
    throw notFound("Your resident profile could not be found.");
  }

  // Every query below is pinned to `resident: residentId`, so authorization is
  // enforced by the query itself rather than by filtering after the fact.
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
      // Either not scheduled yet, or scheduled for a moment still to come.
      $or: [{ slotStart: null }, { slotStart: { $gte: now } }],
    }),

    Appointment.countDocuments({
      ...ownedByResident,
      status: { $in: ATTENDED_STATUSES },
      slotStart: { $ne: null, $lt: now },
    }),

    // A health record is an appointment in this system — `records.tsx` already
    // derives the resident's records from their appointments, and there is no
    // separate records collection to count instead.
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
        // Absent for most accounts; the client renders initials instead.
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
