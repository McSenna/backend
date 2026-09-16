"use strict";

const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { computeAgeYears, ageToTier } = require("../utils/priorityQueue");
const { queueFilter } = require("./queueScope");

const RESIDENT_QUEUE_FIELDS = "fullname email dateOfBirth gender phone";

const buildAgeRefreshOp = (appointment, priorityTag, age) => ({
  updateOne: {
    filter: { _id: appointment._id },
    update: { $set: { ageTier: priorityTag, prioritySortKey: priorityTag, ageAtSubmission: age } },
  },
});

const byPriorityThenAge = (a, b) => {
  if (a.prioritySortKey !== b.prioritySortKey) return a.prioritySortKey - b.prioritySortKey;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
};

const loadPendingQueue = async (visibleKeys) => {
  const pending = await Appointment.find({ status: "pending", ...queueFilter(visibleKeys) })
    .populate("resident", RESIDENT_QUEUE_FIELDS)
    .lean();

  const bulkOps = [];
  for (const appointment of pending) {
    const age = computeAgeYears(appointment.resident?.dateOfBirth);
    const priorityTag = ageToTier(age);

    const stale =
      appointment.ageTier !== priorityTag ||
      appointment.prioritySortKey !== priorityTag ||
      appointment.ageAtSubmission !== age;

    if (stale) bulkOps.push(buildAgeRefreshOp(appointment, priorityTag, age));

    appointment.ageTier = priorityTag;
    appointment.prioritySortKey = priorityTag;
    appointment.ageAtSubmission = age;
  }

  if (bulkOps.length) await Appointment.bulkWrite(bulkOps, { ordered: true });

  pending.sort(byPriorityThenAge);
  return pending;
};

const loadAppointments = ({ visibleKeys, status, missionScheduleId }) => {
  const filter = { ...queueFilter(visibleKeys) };
  if (status) filter.status = status;
  if (missionScheduleId && mongoose.isValidObjectId(missionScheduleId)) {
    filter.missionSchedule = missionScheduleId;
  }

  return Appointment.find(filter)
    .sort({ createdAt: -1 })
    .populate("resident", RESIDENT_QUEUE_FIELDS)
    .populate("missionSchedule", "date")
    .lean();
};

module.exports = { loadPendingQueue, loadAppointments };
