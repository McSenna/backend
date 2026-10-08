"use strict";

const Appointment = require("../../models/Appointment");
const { pushStatusHistory } = require("../../models/Appointment");
const { conflict, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { withBookingDayLock } = require("../appointment/dayLock");
const { buildRescheduleNotifications } = require("../residentAppointment/rescheduleNotice");
const {
  RESCHEDULABLE_STATUSES,
  assertOwnership,
  assertStatusAllows,
  formatSlotLabels,
  loadFullAppointment,
  logAction,
  notify,
  serviceLabelOf,
} = require("../residentAppointment/shared");
const { endOfPosition } = require("./weeklyCalendar");
const { parseBookableDay } = require("./weeklyRequest");
const { dayLockKey, fullDayConflict } = require("./weeklyBooking");
const { loadBookedOnDay, openStarts } = require("./weeklySlots");

/**
 * Moves the visit to the earliest open position of the chosen day. The old
 * position is released by the same write, and nobody else is shifted. Checked
 * on a copy read inside the day lock, so a concurrent change is seen first.
 */
const moveToFirstOpen = async ({ appointmentId, residentId, actorRole, categoryKey, dayStart, now }) =>
  withBookingDayLock(dayLockKey(categoryKey, dayStart), async (session) => {
    const appointment = await Appointment.findById(appointmentId).session(session);
    if (!appointment) throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
    assertOwnership(appointment, residentId, actorRole, "reschedule");
    assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

    const booked = await loadBookedOnDay(categoryKey, dayStart, session);
    const [slotStart] = openStarts({ categoryKey, dayStart, booked, now, excludeAppointmentId: String(appointment._id) });
    if (!slotStart) throw fullDayConflict(categoryKey, dayStart);
    if (appointment.slotStart && slotStart.getTime() === new Date(appointment.slotStart).getTime()) {
      throw conflict(
        "You already have the earliest open time on that Thursday. Please choose another Thursday.",
        ERROR_CODES.SLOT_UNAVAILABLE
      );
    }

    const previousSlotStart = appointment.slotStart;
    const slotEnd = endOfPosition(categoryKey, slotStart);
    appointment.missionSchedule = null;
    appointment.assignedCategoryKey = categoryKey;
    appointment.assignedDurationMinutes = Math.round((slotEnd - slotStart) / 60000);
    appointment.slotStart = slotStart;
    appointment.slotEnd = slotEnd;
    appointment.immunizationSlotKey = slotStart.toISOString();
    appointment.status = "rescheduled";
    appointment.reschedulePriorityAt = now;
    if (!appointment.approvedAt) appointment.approvedAt = now;
    pushStatusHistory(appointment, "rescheduled", residentId, "Rescheduled by resident");
    await appointment.save({ session });
    return { appointment, previousSlotStart };
  });

const rescheduleWeeklyByResident = async ({ req, appointment, residentId, actorRole, appointmentDate }) => {
  const now = new Date();
  const categoryKey = appointment.consultationType;
  const dayStart = parseBookableDay(categoryKey, appointmentDate, now);
  const staffId = appointment.assignedBy;

  const { appointment: updated, previousSlotStart } = await moveToFirstOpen({
    appointmentId: appointment._id,
    residentId,
    actorRole,
    categoryKey,
    dayStart,
    now,
  });

  const serviceLabel = serviceLabelOf(categoryKey);
  const labels = formatSlotLabels(updated.slotStart);
  await notify(buildRescheduleNotifications({ appointment: updated, serviceLabel, labels, staffId }), "resident-reschedule");

  logAction({
    req,
    action: "APPOINTMENT_RESCHEDULED",
    residentId,
    actorRole,
    appointmentId: updated._id,
    description: `${serviceLabel} appointment was rescheduled by the resident to ${labels.date} ${labels.time}`,
    metadata: {
      consultationType: categoryKey,
      previousSlotStart: previousSlotStart ? new Date(previousSlotStart).toISOString() : null,
      slotStart: updated.slotStart.toISOString(),
      scheduling: "weekly",
    },
  });

  return { appointment: await loadFullAppointment(updated._id) };
};

module.exports = { rescheduleWeeklyByResident };
