"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
} = require("../../services/triageQueue");
const {
  normalizeDateInput,
  resolveDayWindows,
  normalizeCategories,
} = require("../../services/mission/missionPayload");
const {
  releaseAppointmentsThatNoLongerFit,
  releaseAllAppointments,
} = require("../../services/mission/missionRebooking");
const { DEFAULT_WINDOWS, assertDateIsFree, logScheduleChange } = require("./missionShared");

exports.createMissionSchedule = asyncHandler(async (req, res) => {
  const { date } = req.body;
  if (!date) {
    throw badRequest("A mission date is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const day = normalizeDateInput(date);
  if (!day) {
    throw badRequest("Please provide a valid mission date.", ERROR_CODES.VALIDATION_ERROR);
  }

  await assertDateIsFree(day);

  const windows = resolveDayWindows(req.body, DEFAULT_WINDOWS);
  const categories = normalizeCategories(req.body.categories);

  const mission = await MissionSchedule.create({
    date: day,
    ...windows,
    categories,
    createdBy: req.user.userId,
  });

  await processMissionSchedulePriorityQueue(mission._id, { staffId: req.user.userId });

  await logScheduleChange({
    req,
    action: "SCHEDULE_CREATED",
    description: "Mission schedule created",
    resourceId: String(mission._id),
    metadata: {
      date: mission.date ? new Date(mission.date).toISOString() : null,
      categoryCount: (mission.categories || []).length,
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Mission schedule created successfully.",
    missionSchedule: mission,
  });
});

exports.updateMissionSchedule = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "mission schedule");
  const { date } = req.body;

  const mission = await MissionSchedule.findById(id);
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  const day = date != null ? normalizeDateInput(date) : mission.date;
  if (date != null && !day) {
    throw badRequest("Please provide a valid mission date.", ERROR_CODES.VALIDATION_ERROR);
  }

  await assertDateIsFree(day, mission._id);

  const windows = resolveDayWindows(req.body, mission);
  const categories = normalizeCategories(req.body.categories);

  mission.date = day;
  Object.assign(mission, windows);
  mission.categories = categories;
  await mission.save();

  const updatedMission = await MissionSchedule.findById(mission._id).lean();
  await releaseAppointmentsThatNoLongerFit(updatedMission);

  await processMissionSchedulePriorityQueue(mission._id, { staffId: req.user.userId });

  await logScheduleChange({
    req,
    action: "SCHEDULE_UPDATED",
    description: "Mission schedule updated",
    resourceId: String(mission._id),
    metadata: { date: day ? new Date(day).toISOString() : null },
  });

  return res.json({
    success: true,
    message: "Mission schedule updated successfully.",
    missionSchedule: await MissionSchedule.findById(mission._id).lean(),
  });
});

exports.deleteMissionSchedule = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "mission schedule");
  const mission = await MissionSchedule.findById(id);
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  await releaseAllAppointments(mission._id);
  await MissionSchedule.deleteOne({ _id: mission._id });
  await processUpcomingMissionSchedulesPriorityQueue({ staffId: req.user.userId });

  await logScheduleChange({
    req,
    action: "SCHEDULE_DELETED",
    description: "Mission schedule deleted",
    resourceId: String(mission._id),
    metadata: { date: mission.date ? new Date(mission.date).toISOString() : null },
  });

  return res.json({
    success: true,
    message: "Mission schedule deleted successfully.",
    deleted: true,
  });
});
