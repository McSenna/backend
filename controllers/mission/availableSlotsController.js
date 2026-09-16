"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const Appointment = require("../../models/Appointment");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { getCategory, resolveDurationMinutes } = require("../../config/consultationCategories");
const { listAvailableStarts, suggestNextAvailableSlot } = require("../../utils/slotAvailability");
const { BOOKED_STATUSES } = require("../../services/mission/missionRebooking");

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

  const resolvedDuration = resolveDurationMinutes(
    categoryKey,
    durationMinutes != null ? Number(durationMinutes) : undefined
  );
  if (resolvedDuration == null) {
    throw badRequest(
      "The requested duration is not allowed for that category.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: BOOKED_STATUSES },
  })
    .select("slotStart slotEnd")
    .lean();

  const exclude = excludeAppointmentId || null;

  return res.json({
    success: true,
    message: "Available slots computed.",
    durationMinutes: resolvedDuration,
    availableSlotStarts: listAvailableStarts(mission, booked, resolvedDuration, exclude),
    suggestedNextSlotStart: suggestNextAvailableSlot(mission, booked, resolvedDuration, exclude),
  });
});
