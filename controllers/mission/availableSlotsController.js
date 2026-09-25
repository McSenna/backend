"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { getCategory } = require("../../config/consultationCategories");
const { listAvailableStarts } = require("../../utils/slotAvailability");
const {
  loadBookedForMission,
  resolveMissionDuration,
} = require("../../services/appointment/slotService");

exports.getAvailableSlots = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "mission schedule");
  const { categoryKey, durationMinutes, excludeAppointmentId } = req.query;

  if (!categoryKey) {
    throw badRequest("A consultation category is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const mission = await MissionSchedule.findById(id).lean();
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  if (!getCategory(categoryKey)) {
    throw badRequest(
      "That consultation category is not recognised.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const resolvedDuration = resolveMissionDuration(mission, categoryKey, durationMinutes);

  // Must use the same occupancy rule as the assign step (processing and completed
  // visits still hold their slot); otherwise listed slots fail on submit.
  const booked = await loadBookedForMission(mission._id);
  const availableSlotStarts = listAvailableStarts(
    mission,
    booked,
    resolvedDuration,
    excludeAppointmentId || null
  );

  return res.json({
    success: true,
    message: "Available slots computed.",
    durationMinutes: resolvedDuration,
    availableSlotStarts,
    suggestedNextSlotStart: availableSlotStarts[0] ?? null,
  });
});
