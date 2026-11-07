"use strict";

const Appointment = require("../../models/Appointment");
const { UNKNOWN_PRIORITY_GROUP, priorityOf } = require("../../utils/priorityQueue");
const { reschedulePriorityRank } = require("../appointment/reschedulePriority");

const timeOf = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
};

/**
 * Recomputes the priority group of each pending appointment and writes it onto
 * the objects in place, persisting only the rows whose stored group changed.
 *
 * The age is taken on the day of ranking, not the day of the request: the queue
 * already worked this way, so a resident who turns 60 while waiting moves up.
 */
const tagPendingAppointments = async (pendingAppointments, now = new Date()) => {
  const bulkOps = [];

  for (const appointment of pendingAppointments) {
    // An immunization is for the child, so the child's age sets the group.
    const { ageYears, group: priorityTag } = priorityOf(
      appointment?.childDateOfBirth ?? appointment?.resident?.dateOfBirth,
      now
    );

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

  const pa = a.prioritySortKey ?? UNKNOWN_PRIORITY_GROUP;
  const pb = b.prioritySortKey ?? UNKNOWN_PRIORITY_GROUP;
  if (pa !== pb) return pa - pb;

  // Same group: earliest request first. The id breaks an exact tie, so two runs
  // over the same rows always pick the same one.
  const ca = timeOf(a.createdAt);
  const cb = timeOf(b.createdAt);
  if (ca !== cb) return ca - cb;
  return String(a._id ?? "").localeCompare(String(b._id ?? ""));
};

module.exports = { tagPendingAppointments, byPriorityThenCreated };
