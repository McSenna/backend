"use strict";

const Appointment = require("../../models/Appointment");
const { ageToTier, computeAgeYears } = require("../../utils/priorityQueue");
const { reschedulePriorityRank } = require("../appointment/reschedulePriority");

const DEFAULT_PRIORITY = 4;

/**
 * Recomputes the age tier of each pending appointment (a resident can age into
 * a different tier while waiting), writes it onto the objects in place, and
 * persists only the rows whose stored tier actually changed.
 */
const tagPendingAppointments = async (pendingAppointments) => {
  const bulkOps = [];

  for (const appointment of pendingAppointments) {
    // An immunization is for the child, so the child's age sets the tier.
    const ageYears = computeAgeYears(appointment?.childDateOfBirth ?? appointment?.resident?.dateOfBirth);
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
  // A resident who rescheduled a first-slot service (immunization) and was sent
  // back to pending, e.g. by a mission edit, is re-slotted ahead of new requests.
  const ra = reschedulePriorityRank(a);
  const rb = reschedulePriorityRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;

  const pa = a.prioritySortKey ?? DEFAULT_PRIORITY;
  const pb = b.prioritySortKey ?? DEFAULT_PRIORITY;
  if (pa !== pb) return pa - pb;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
};

module.exports = { tagPendingAppointments, byPriorityThenCreated };
