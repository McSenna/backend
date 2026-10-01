"use strict";

const { loadAppointmentOrFail } = require("../appointment/lookup");
const { listBookableSchedules } = require("../appointment/bookableSchedules");
const { takesFirstOpenSlot } = require("../appointment/reschedulePriority");
const { isWeeklyService } = require("../../config/consultationCategories");
const { listWeeklyDays } = require("../immunization/weeklySlots");
const { RESCHEDULABLE_STATUSES, assertOwnership, assertStatusAllows } = require("./shared");

const getRescheduleOptionsForAppointment = async ({ appointmentId, residentId, actorRole }) => {
  const appointment = await loadAppointmentOrFail(appointmentId);
  assertOwnership(appointment, residentId, actorRole, "view");
  assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

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
    appointment: {
      _id: String(appointment._id),
      consultationType: appointment.consultationType,
      status: appointment.status,
      slotStart: appointment.slotStart,
      slotEnd: appointment.slotEnd,
      missionSchedule: appointment.missionSchedule ? String(appointment.missionSchedule) : null,
    },
    // When true the app shows the first open start of the chosen date instead of
    // a time picker; the server assigns that start when the move is saved.
    assignsEarliestSlot: takesFirstOpenSlot(appointment.consultationType),
    scheduling: weekly ? "weekly" : "mission",
    schedules: [],
    ...options,
  };
};

module.exports = { getRescheduleOptionsForAppointment };
