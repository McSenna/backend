"use strict";

const Appointment = require("../../models/Appointment");
const { ageToTier, computeAgeYears } = require("../../utils/priorityQueue");

const DEFAULT_PRIORITY = 4;

/**
 * Recomputes the age tier of each pending appointment (a resident can age into
 * a different tier while waiting), writes it onto the objects in place, and
 * persists only the rows whose stored tier actually changed.
 */
const tagPendingAppointments = async (pendingAppointments) => {
  const bulkOps = [];

  for (const appointment of pendingAppointments) {
    const ageYears = computeAgeYears(appointment?.resident?.dateOfBirth);
    const priorityTag = ageToTier(ageYears);

    const stale =
      appointment.ageTier !== priorityTag ||
      appointment.prioritySortKey !== priorityTag ||
      appointment.ageAtSubmission !== ageYears;

    if (stale) {
      bulkOps.push({
        updateOne: {
          filter: { _id: appointment._id },
          update: {
            $set: { ageTier: priorityTag, prioritySortKey: priorityTag, ageAtSubmission: ageYears },
          },
        },
      });
    }

    appointment.ageTier = priorityTag;
    appointment.prioritySortKey = priorityTag;
    appointment.ageAtSubmission = ageYears;
  }

  if (bulkOps.length) {
    await Appointment.bulkWrite(bulkOps, { ordered: true });
  }
};

const byPriorityThenCreated = (a, b) => {
  const pa = a.prioritySortKey ?? DEFAULT_PRIORITY;
  const pb = b.prioritySortKey ?? DEFAULT_PRIORITY;
  if (pa !== pb) return pa - pb;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
};

module.exports = { tagPendingAppointments, byPriorityThenCreated };
