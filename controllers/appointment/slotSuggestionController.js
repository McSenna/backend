"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { assertValidObjectId } = require("../../utils/objectId");
const { suggestNextAvailableSlot } = require("../../utils/slotAvailability");
const MissionSchedule = require("../../models/MissionSchedule");
const {
  loadBookedForMission,
  resolveMissionDuration,
} = require("../../services/appointment/slotService");

exports.suggestSlot = asyncHandler(async (req, res) => {
  const { missionScheduleId, categoryKey, durationMinutes, excludeAppointmentId } = req.query;
  if (!missionScheduleId || !categoryKey) {
    throw badRequest(
      "A mission schedule and consultation category are required.",
      ERROR_CODES.MISSING_FIELDS
    );
  }
  assertValidObjectId(missionScheduleId, "mission schedule");

  const mission = await MissionSchedule.findById(missionScheduleId).lean();
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  const resolvedDuration = resolveMissionDuration(mission, categoryKey, durationMinutes);

  const booked = await loadBookedForMission(mission._id);
  const suggestedNextSlotStart = suggestNextAvailableSlot(
    mission,
    booked,
    resolvedDuration,
    excludeAppointmentId || null
  );

  return res.json({
    success: true,
    message: "Slot suggestion computed.",
    suggestedNextSlotStart,
    durationMinutes: resolvedDuration,
  });
});
