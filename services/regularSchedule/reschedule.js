"use strict";

const Appointment = require("../../models/Appointment");
const { pushStatusHistory } = require("../../models/Appointment");
const { conflict, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { assertNoSameDayBooking } = require("../appointment/bookingCommit");
const { withBookingDayLock } = require("../appointment/dayLock");
const { dayLockKey } = require("../immunization/weeklyBooking");
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
const { assertStillOpen, slotFields } = require("./booking");
const { parseRegularStart } = require("./request");

/**
 * Moves the visit to the date and start the resident chose, under the target
 * day's lock and on a copy read inside it. The old slot is released by the same
 * write; nobody else is moved.
 */
const moveToChosenStart = ({ appointmentId, residentId, actorRole, categoryKey, dayStart, slotStartDate }) =>
  withBookingDayLock(dayLockKey(categoryKey, dayStart), async (session) => {
    const appointment = await Appointment.findById(appointmentId).session(session);
    if (!appointment) throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
    assertOwnership(appointment, residentId, actorRole, "reschedule");
    assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

    if (appointment.slotStart && new Date(appointment.slotStart).getTime() === slotStartDate.getTime()) {
      throw conflict("That is already your appointment time. Please choose a different time.", ERROR_CODES.SLOT_UNAVAILABLE);
    }
    await assertNoSameDayBooking({
      residentId: appointment.resident,
      categoryKey,
      slotStartDate,
      session,
      excludeAppointmentId: appointment._id,
    });
    await assertStillOpen({ categoryKey, dayStart, start: slotStartDate, session, excludeAppointmentId: String(appointment._id) });

    const previousSlotStart = appointment.slotStart;
    Object.assign(appointment, slotFields(categoryKey, slotStartDate), { status: "rescheduled" });
    if (!appointment.approvedAt) appointment.approvedAt = new Date();
    pushStatusHistory(appointment, "rescheduled", residentId, "Rescheduled by resident");
    await appointment.save({ session });
    return { appointment, previousSlotStart };
  });

const rescheduleRegularByResident = async ({ req, appointment, residentId, actorRole, appointmentDate, slotStart }) => {
  const categoryKey = appointment.consultationType;
  const { dayStart, slotStartDate } = parseRegularStart(categoryKey, { appointmentDate, slotStart }, new Date());
  const staffId = appointment.assignedBy;

  const { appointment: updated, previousSlotStart } = await moveToChosenStart({
    appointmentId: appointment._id,
    residentId,
    actorRole,
    categoryKey,
    dayStart,
    slotStartDate,
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
      slotEnd: updated.slotEnd.toISOString(),
      scheduling: "regular",
    },
  });

  return { appointment: await loadFullAppointment(updated._id) };
};

module.exports = { rescheduleRegularByResident };
