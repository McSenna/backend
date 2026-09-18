"use strict";

const Appointment = require("../models/Appointment");
const { pushStatusHistory } = require("../models/Appointment");
const { validateDurationForCategory } = require("../config/consultationCategories");
const {
  getMissionDayWindows,
  isIntervalInsideWindows,
  hasConflict,
} = require("../utils/slotAvailability");
const { badRequest, conflict } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const { SLOT_OCCUPYING_STATUSES } = require("./queueScope");

const loadBookedForMission = (missionId) =>
  Appointment.find({
    missionSchedule: missionId,
    status: { $in: SLOT_OCCUPYING_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .lean();

const resolveDuration = (categoryKey, durationMinutes) => {
  const result = validateDurationForCategory(categoryKey, durationMinutes);
  if (!result.ok) throw badRequest(result.message, ERROR_CODES.VALIDATION_ERROR);
  return result.durationMinutes;
};

const resolveSlotInterval = (slotStart, durationMinutes) => {
  const slotStartDate = new Date(slotStart);
  if (Number.isNaN(slotStartDate.getTime())) {
    throw badRequest(
      "The selected appointment time is not a valid date.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return {
    slotStartDate,
    slotEndDate: new Date(slotStartDate.getTime() + durationMinutes * 60 * 1000),
  };
};

const assertSlotIsAvailable = async ({ appointment, mission, slotStartDate, slotEndDate }) => {
  const windows = getMissionDayWindows(mission);
  if (!windows.length) {
    throw badRequest(
      "This mission schedule has no usable time windows. Please update the schedule first.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  if (!isIntervalInsideWindows(windows, slotStartDate, slotEndDate)) {
    throw badRequest(
      "The selected time falls outside the mission's morning and afternoon windows.",
      ERROR_CODES.SLOT_UNAVAILABLE
    );
  }

  const booked = await loadBookedForMission(mission._id);
  if (hasConflict(booked, slotStartDate, slotEndDate, String(appointment._id))) {
    throw conflict(
      "The selected appointment schedule is no longer available. Please choose another time.",
      ERROR_CODES.SLOT_UNAVAILABLE
    );
  }
};

const validateAndAssignSlot = async ({
  appointment,
  mission,
  categoryKey,
  durationMinutes,
  slotStart,
  staffId,
  isReassign,
}) => {
  const resolvedDuration = resolveDuration(categoryKey, durationMinutes);
  const { slotStartDate, slotEndDate } = resolveSlotInterval(slotStart, resolvedDuration);

  await assertSlotIsAvailable({ appointment, mission, slotStartDate, slotEndDate });

  const hadSlot = Boolean(appointment.slotStart && appointment.missionSchedule);

  appointment.missionSchedule = mission._id;
  appointment.assignedCategoryKey = categoryKey;
  appointment.assignedDurationMinutes = resolvedDuration;
  appointment.slotStart = slotStartDate;
  appointment.slotEnd = slotEndDate;
  appointment.assignedBy = staffId;
  appointment.assignedAt = new Date();
  appointment.status = isReassign && hadSlot ? "rescheduled" : "confirmed";

  if (!appointment.approvedAt) appointment.approvedAt = new Date();
  pushStatusHistory(appointment, appointment.status, staffId);

  await appointment.save();
  return appointment;
};

module.exports = {
  loadBookedForMission,
  resolveDuration,
  validateAndAssignSlot,
  assertSlotIsAvailable,
};
