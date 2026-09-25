"use strict";

const mongoose = require("mongoose");
const Appointment = require("../../models/Appointment");
const { tagPendingAppointments, byPriorityThenCreated } = require("../triage/triagePriority");
const { queueFilter } = require("../queueScope");

const RESIDENT_QUEUE_FIELDS = "fullname email dateOfBirth gender phone";

const loadPendingQueue = async (visibleKeys) => {
  const pending = await Appointment.find({ status: "pending", ...queueFilter(visibleKeys) })
    .populate("resident", RESIDENT_QUEUE_FIELDS)
    .lean();

  await tagPendingAppointments(pending);
  return pending.sort(byPriorityThenCreated);
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
