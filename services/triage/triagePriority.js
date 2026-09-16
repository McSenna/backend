"use strict";

const Appointment = require("../../models/Appointment");
const { ageToTier, computeAgeYears } = require("../../utils/priorityQueue");

const DEFAULT_PRIORITY = 4;

const computePriority = (residentDOB) => {
  const ageYears = computeAgeYears(residentDOB);
  return { ageYears, priorityTag: ageToTier(ageYears) };
};

const tagPendingAppointments = async (pendingAppointments) => {
  const bulkOps = [];

  for (const appointment of pendingAppointments) {
    const { ageYears, priorityTag } = computePriority(appointment?.resident?.dateOfBirth);

    bulkOps.push({
      updateOne: {
        filter: { _id: appointment._id },
        update: {
          $set: {
            ageTier: priorityTag,
            prioritySortKey: priorityTag,
            ageAtSubmission: ageYears,
          },
        },
      },
    });

    appointment._computedPriorityTag = priorityTag;
    appointment._computedAgeYears = ageYears;
  }

  if (bulkOps.length) {
    await Appointment.bulkWrite(bulkOps, { ordered: true });
  }
};

const byPriorityThenCreated = (a, b) => {
  const pa = a._computedPriorityTag ?? a.prioritySortKey ?? DEFAULT_PRIORITY;
  const pb = b._computedPriorityTag ?? b.prioritySortKey ?? DEFAULT_PRIORITY;
  if (pa !== pb) return pa - pb;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
};

module.exports = { tagPendingAppointments, byPriorityThenCreated };
