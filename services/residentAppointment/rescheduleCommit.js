"use strict";

const Appointment = require("../../models/Appointment");
const { pushStatusHistory } = require("../../models/Appointment");
const { assertSlotIsAvailable } = require("../appointment/slotService");
const { withMissionSlotLock } = require("../appointment/slotLock");
const { notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { RESCHEDULABLE_STATUSES, assertOwnership, assertStatusAllows } = require("./shared");

/**
 * Checks and writes the new slot under the mission lock, on a copy of the
 * appointment read inside it, so a concurrent booking, cancellation or staff
 * change is seen before anything is written. Updates the same record in place.
 */
const commitResidentReschedule = ({ appointmentId, residentId, actorRole, mission, durationMinutes, slotStartDate }) =>
  withMissionSlotLock(mission._id, async (session) => {
    const appointment = await Appointment.findById(appointmentId).session(session);
    if (!appointment) {
      throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
    }
    assertOwnership(appointment, residentId, actorRole, "reschedule");
    assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

    const slotEndDate = new Date(slotStartDate.getTime() + durationMinutes * 60 * 1000);
    await assertSlotIsAvailable({ appointment, mission, slotStartDate, slotEndDate, session });

    appointment.missionSchedule = mission._id;
    appointment.assignedCategoryKey = appointment.consultationType;
    appointment.assignedDurationMinutes = durationMinutes;
    appointment.slotStart = slotStartDate;
    appointment.slotEnd = slotEndDate;
    appointment.status = "rescheduled";
    if (!appointment.approvedAt) appointment.approvedAt = new Date();

    pushStatusHistory(appointment, "rescheduled", residentId, "Rescheduled by resident");
    await appointment.save({ session });
    return appointment;
  });

module.exports = { commitResidentReschedule };
