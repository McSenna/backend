"use strict";

const { loadAppointmentOrFail } = require("../appointment/lookup");
const { listBookableSchedules } = require("../appointment/bookableSchedules");
const { takesFirstOpenSlot } = require("../appointment/reschedulePriority");
const { isWeeklyService, residentPicksTime } = require("../../config/consultationCategories");
const { listRegularOptions } = require("../regularSchedule/availability");
const { listWeeklyDays } = require("../immunization/weeklySlots");
const { RESCHEDULABLE_STATUSES, assertOwnership, assertStatusAllows } = require("./shared");
const {badRequest}=require('../../utils/AppError');

const summaryOf = (appointment) => ({
  _id: String(appointment._id),
  consultationType: appointment.consultationType,
  status: appointment.status,
  slotStart: appointment.slotStart,
  slotEnd: appointment.slotEnd,
  missionSchedule: appointment.missionSchedule ? String(appointment.missionSchedule) : null,
});

const getRescheduleOptionsForAppointment = async ({ appointmentId, residentId, actorRole, month = null, date = null }) => {
  const appointment = await loadAppointmentOrFail(appointmentId);
  assertOwnership(appointment, residentId, actorRole, "view");
  assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");
  if (appointment.consultationType === 'immunization') throw badRequest('Immunization dates are assigned by the system. Contact the midwife for follow-up.');

  // BP checking offers its own calendar; its current slot counts as free, so
  // the resident can see it, but moving onto it is refused as no change.
  if (residentPicksTime(appointment.consultationType)) {
    const regular = await listRegularOptions(appointment.consultationType, { month, date, excludeAppointmentId: appointment._id });
    return { appointment: summaryOf(appointment), assignsEarliestSlot: false, schedules: [], ...regular };
  }

  // A weekly service (immunization) offers its own days, never mission dates.
  const weekly = isWeeklyService(appointment.consultationType);
  const options = weekly
    ? { days: await listWeeklyDays(appointment.consultationType, { excludeAppointmentId: appointment._id }) }
    : {
        schedules: await listBookableSchedules({
          categoryKey: appointment.consultationType,
          excludeAppointmentId: appointment._id,
        }),
      };

  return {
    appointment: summaryOf(appointment),
    // When true the app shows the first open start of the chosen date instead of
    // a time picker; the server assigns that start when the move is saved.
    assignsEarliestSlot: takesFirstOpenSlot(appointment.consultationType),
    scheduling: weekly ? "weekly" : "mission",
    schedules: [],
    ...options,
  };
};

module.exports = { getRescheduleOptionsForAppointment };
