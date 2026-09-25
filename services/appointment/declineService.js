"use strict";

const { pushStatusHistory } = require("../../models/Appointment");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { loadAppointmentOrFail } = require("./lookup");

const DECLINABLE_STATUSES = ["pending", "confirmed", "rescheduled"];

const declineAppointment = async ({ appointmentId, reason, actorId }) => {
  const appointment = await loadAppointmentOrFail(appointmentId);

  if (appointment.status === "declined") {
    return { appointment, alreadyDeclined: true };
  }
  if (!DECLINABLE_STATUSES.includes(appointment.status)) {
    throw conflict(
      `An appointment that is ${appointment.status} can no longer be declined.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  const previousSlotStart = appointment.slotStart;
  const freedMissionScheduleId = appointment.missionSchedule;
  const assignedBy = appointment.assignedBy;

  appointment.status = "declined";
  pushStatusHistory(appointment, "declined", actorId);
  appointment.declineReason = typeof reason === "string" ? reason.slice(0, 1000) : "";
  appointment.missionSchedule = null;
  appointment.slotStart = null;
  appointment.slotEnd = null;
  appointment.assignedCategoryKey = null;
  appointment.assignedDurationMinutes = null;
  await appointment.save();

  return {
    appointment,
    alreadyDeclined: false,
    previousSlotStart,
    freedMissionScheduleId,
    assignedBy,
  };
};

module.exports = { declineAppointment };
