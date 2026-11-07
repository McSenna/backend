"use strict";

const Appointment = require("../../models/Appointment");
const {
  getMissionDayWindows,
  isIntervalInsideWindows,
} = require("../../utils/slotAvailability");
const { BOOKED_STATUSES } = require("../queueScope");
const { CONSULTATION_CATEGORIES } = require("../../config/consultationCategories");

// Weekly visits (immunization) never depend on a mission: older ones booked
// through a mission keep their time when that mission is edited or deleted.
const MISSION_SERVICE_FILTER = {
  consultationType: {
    $nin: CONSULTATION_CATEGORIES.filter((category) => category.scheduling === "weekly").map((category) => category.key),
  },
};

const RESET_TO_PENDING = {
  status: "pending",
  missionSchedule: null,
  assignedCategoryKey: null,
  assignedDurationMinutes: null,
  slotStart: null,
  slotEnd: null,
  assignedBy: null,
  assignedAt: null,
};

const stillFits = (appointment, windows, categoryMap) => {
  const okSlot =
    appointment.slotStart &&
    appointment.slotEnd &&
    windows.length > 0 &&
    isIntervalInsideWindows(windows, appointment.slotStart, appointment.slotEnd);

  const key = appointment.assignedCategoryKey;
  const expectedDuration = key ? categoryMap.get(key) : null;
  const okCategory =
    Boolean(key) &&
    expectedDuration != null &&
    Number(appointment.assignedDurationMinutes) === Number(expectedDuration);

  return okSlot && okCategory;
};

const RELEASED_FIELDS = "_id resident consultationType slotStart";

// The visit goes back to pending with its original request time, so it keeps
// its place in line, and the history says why it lost its slot.
const releaseOps = (rows, note) =>
  rows.map((appointment) => ({
    updateOne: {
      filter: { _id: appointment._id, status: { $in: BOOKED_STATUSES } },
      update: {
        $set: { ...RESET_TO_PENDING, declineReason: "" },
        $push: { statusHistory: { status: "pending", timestamp: new Date(), changedBy: null, note } },
      },
    },
  }));

const toReleased = (appointment) => ({
  _id: appointment._id,
  resident: appointment.resident,
  consultationType: appointment.consultationType,
  slotStart: appointment.slotStart,
});

/** Returns the visits it released, with the slot each one had, for the notice that follows. */
const releaseAppointmentsThatNoLongerFit = async (mission) => {
  const windows = getMissionDayWindows(mission);
  const categoryMap = new Map(
    (mission.categories || []).map((category) => [category.categoryKey, category.durationMinutes])
  );

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: BOOKED_STATUSES },
    ...MISSION_SERVICE_FILTER,
  }).lean();

  const released = booked.filter((appointment) => !stillFits(appointment, windows, categoryMap));
  if (released.length) {
    await Appointment.bulkWrite(releaseOps(released, "Returned to the queue: the mission schedule changed"), { ordered: true });
  }
  return released.map(toReleased);
};

const releaseAllAppointments = async (missionId) => {
  const booked = await Appointment.find({
    missionSchedule: missionId,
    status: { $in: BOOKED_STATUSES },
    ...MISSION_SERVICE_FILTER,
  })
    .select(RELEASED_FIELDS)
    .lean();
  if (booked.length) {
    await Appointment.bulkWrite(releaseOps(booked, "Returned to the queue: the mission was removed"), { ordered: true });
  }
  return booked.map(toReleased);
};

module.exports = { releaseAppointmentsThatNoLongerFit, releaseAllAppointments };
