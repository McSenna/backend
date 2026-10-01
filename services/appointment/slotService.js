"use strict";

const Appointment = require("../../models/Appointment");
const { pushStatusHistory } = require("../../models/Appointment");
const { validateDurationForCategory } = require("../../config/consultationCategories");
const {
  getMissionDayWindows,
  isIntervalInsideWindows,
  hasConflict,
} = require("../../utils/slotAvailability");
const { badRequest, conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { SLOT_OCCUPYING_STATUSES } = require("../queueScope");
const { assertServiceDay } = require("./serviceDayRules");
const { assertMissionService } = require("./missionServiceRules");
const { withMissionSlotLock } = require("./slotLock");

const STALE_MESSAGE = "This appointment has already been updated. Please refresh and try again.";

const loadBookedForMission = (missionId, session = null) =>
  Appointment.find({
    missionSchedule: missionId,
    status: { $in: SLOT_OCCUPYING_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .session(session)
    .lean();

const resolveDuration = (categoryKey, durationMinutes) => {
  const result = validateDurationForCategory(categoryKey, durationMinutes);
  if (!result.ok) throw badRequest(result.message, ERROR_CODES.VALIDATION_ERROR);
  return result.durationMinutes;
};

const missionDurationFor = (mission, categoryKey) =>
  mission.categories?.find((category) => category.categoryKey === categoryKey)?.durationMinutes;

// Range categories (General Checkup 15–20 min, Consultation 20–30 min) run at
// the duration the mission configured. When the caller does not ask for a
// specific length, default to that rather than the category minimum; otherwise
// slot listings offer 15-minute starts that a 20-minute assignment then rejects.
const resolveMissionDuration = (mission, categoryKey, requestedMinutes) => {
  const hasRequest = requestedMinutes != null && requestedMinutes !== "";
  return resolveDuration(
    categoryKey,
    hasRequest ? Number(requestedMinutes) : missionDurationFor(mission, categoryKey)
  );
};

// Also re-checks the service day: a mission saved before a day rule existed
// can still list the service, and must not take new bookings for it.
const assertMissionOffersCategory = (mission, categoryKey) => {
  assertMissionService(categoryKey);
  if (missionDurationFor(mission, categoryKey) == null) {
    throw badRequest(
      "This mission schedule has no slots for the selected consultation category.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  assertServiceDay(categoryKey, mission.date);
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

const assertSlotIsAvailable = async ({ appointment, mission, slotStartDate, slotEndDate, session = null }) => {
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

  const booked = await loadBookedForMission(mission._id, session);
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
  const resolvedDuration = resolveMissionDuration(mission, categoryKey, durationMinutes);
  const { slotStartDate, slotEndDate } = resolveSlotInterval(slotStart, resolvedDuration);

  return withMissionSlotLock(mission._id, async (session) => {
    // The caller validated a copy read before the lock; act on a fresh one.
    const current = await Appointment.findById(appointment._id).session(session);
    if (!current || current.status !== appointment.status) {
      throw conflict(STALE_MESSAGE, ERROR_CODES.INVALID_STATUS_TRANSITION);
    }

    await assertSlotIsAvailable({ appointment: current, mission, slotStartDate, slotEndDate, session });

    const hadSlot = Boolean(current.slotStart && current.missionSchedule);

    current.missionSchedule = mission._id;
    current.assignedCategoryKey = categoryKey;
    current.assignedDurationMinutes = resolvedDuration;
    current.slotStart = slotStartDate;
    current.slotEnd = slotEndDate;
    current.assignedBy = staffId;
    current.assignedAt = new Date();
    current.status = isReassign && hadSlot ? "rescheduled" : "confirmed";

    if (!current.approvedAt) current.approvedAt = new Date();
    pushStatusHistory(current, current.status, staffId);

    await current.save({ session });
    return current;
  });
};

module.exports = {
  loadBookedForMission,
  resolveDuration,
  missionDurationFor,
  resolveMissionDuration,
  assertMissionOffersCategory,
  validateAndAssignSlot,
  assertSlotIsAvailable,
};
