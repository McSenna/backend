"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const {
  cancelAppointmentByResident,
  rescheduleAppointmentByResident,
  getRescheduleOptionsForAppointment,
} = require("../../services/appointment/residentActionService");

exports.cancelAppointment = asyncHandler(async (req, res) => {
  const appointmentId = assertValidObjectId(req.params.id, "appointment");
  const { reason } = req.body || {};

  const result = await cancelAppointmentByResident({
    req,
    appointmentId,
    residentId: req.user.userId,
    reason,
    actorRole: req.user.role,
  });

  return res.json({
    success: true,
    message: result.alreadyCancelled
      ? "Appointment was already cancelled."
      : "Appointment cancelled successfully.",
    appointment: result.appointment,
  });
});

exports.rescheduleAppointment = asyncHandler(async (req, res) => {
  const appointmentId = assertValidObjectId(req.params.id, "appointment");
  const { missionScheduleId, slotStart } = req.body || {};

  const result = await rescheduleAppointmentByResident({
    req,
    appointmentId,
    residentId: req.user.userId,
    missionScheduleId,
    slotStart,
    actorRole: req.user.role,
  });

  return res.json({
    success: true,
    message: "Appointment rescheduled successfully.",
    appointment: result.appointment,
  });
});

exports.getRescheduleOptions = asyncHandler(async (req, res) => {
  const appointmentId = assertValidObjectId(req.params.id, "appointment");

  const data = await getRescheduleOptionsForAppointment({
    appointmentId,
    residentId: req.user.userId,
    actorRole: req.user.role,
  });

  return res.json({
    success: true,
    message: "Reschedule options loaded successfully.",
    ...data,
  });
});
