"use strict";

const Appointment = require("../../models/Appointment");
const {
  getMissionDayWindows,
  isIntervalInsideWindows,
} = require("../../utils/slotAvailability");
const { BOOKED_STATUSES } = require("../queueScope");

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

const releaseAppointmentsThatNoLongerFit = async (mission) => {
  const windows = getMissionDayWindows(mission);
  const categoryMap = new Map(
    (mission.categories || []).map((category) => [category.categoryKey, category.durationMinutes])
  );

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: BOOKED_STATUSES },
  });

  const resetOps = booked
    .filter((appointment) => !stillFits(appointment, windows, categoryMap))
    .map((appointment) => ({
      updateOne: { filter: { _id: appointment._id }, update: { $set: { ...RESET_TO_PENDING } } },
    }));

  if (resetOps.length) {
    await Appointment.bulkWrite(resetOps, { ordered: true });
  }
};

const releaseAllAppointments = (missionId) =>
  Appointment.updateMany(
    { missionSchedule: missionId, status: { $in: BOOKED_STATUSES } },
    { $set: { ...RESET_TO_PENDING, declineReason: "" } }
  );

module.exports = { releaseAppointmentsThatNoLongerFit, releaseAllAppointments };
