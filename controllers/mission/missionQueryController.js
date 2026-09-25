"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const Appointment = require("../../models/Appointment");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { CONSULTATION_CATEGORIES } = require("../../config/consultationCategories");
const { normalizeDateInput } = require("../../services/mission/missionPayload");
const { BOOKED_STATUSES } = require("../../services/queueScope");

exports.listMissionSchedules = asyncHandler(async (req, res) => {
  const { date } = req.query;
  const filter = {};

  if (date) {
    const day = normalizeDateInput(date);
    if (!day) {
      throw badRequest("The date filter is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
    }
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    filter.date = { $gte: day, $lt: next };
  }

  const missionSchedules = await MissionSchedule.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .lean();

  return res.json({
    success: true,
    message: "Mission schedules loaded successfully.",
    missionSchedules,
  });
});

exports.getMissionSchedule = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "mission schedule");
  const mission = await MissionSchedule.findById(id).lean();
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  const bookedAppointments = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: BOOKED_STATUSES },
  })
    .select("slotStart slotEnd assignedCategoryKey resident status")
    .populate("resident", "fullname email")
    .lean();

  return res.json({
    success: true,
    message: "Mission schedule loaded successfully.",
    missionSchedule: mission,
    bookedAppointments,
  });
});

exports.getConsultationCategories = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    message: "Consultation categories loaded successfully.",
    categories: CONSULTATION_CATEGORIES,
  })
);
