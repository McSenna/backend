"use strict";

const MissionSchedule = require("../models/MissionSchedule");
const Appointment = require("../models/Appointment");
const { CONSULTATION_CATEGORIES, getCategory, resolveDurationMinutes } = require("../config/consultationCategories");
const { parseHHMM, listAvailableStarts, suggestNextAvailableSlot, getMissionDayWindows, isIntervalInsideWindows } = require("../utils/slotAvailability");
const {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
} = require("../services/triageQueue");
const { createSystemLog } = require("../services/systemLogService");
const asyncHandler = require("../utils/asyncHandler");
const { assertValidObjectId } = require("../utils/objectId");
const { badRequest, notFound, conflict } = require("../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../utils/errorCodes");

function normalizeDateInput(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}

exports.createMissionSchedule = asyncHandler(async (req, res) => {
  const { date, morning, afternoon, categories, startTime, endTime } = req.body;
  if (!date) {
    throw badRequest("A mission date is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const day = normalizeDateInput(date);
  if (!day) {
    throw badRequest("Please provide a valid mission date.", ERROR_CODES.VALIDATION_ERROR);
  }

  const existing = await MissionSchedule.findOne({ date: day }).lean();
  if (existing) {
    throw conflict("A mission schedule already exists for this date.", ERROR_CODES.DUPLICATE_SCHEDULE);
  }

  const morningStart =
    startTime != null ? String(startTime) : morning?.start || "08:00";
  const morningEnd =
    endTime != null ? String(endTime) : morning?.end || "12:00";
    
  const afternoonStart = startTime != null && endTime != null ? String(endTime) : afternoon?.start || "13:00";
  const afternoonEnd = startTime != null && endTime != null ? String(endTime) : afternoon?.end || "17:00";

  const mStartMin = parseHHMM(morningStart);
  const mEndMin = parseHHMM(morningEnd);
  const aStartMin = parseHHMM(afternoonStart);
  const aEndMin = parseHHMM(afternoonEnd);
  if (mStartMin == null || mEndMin == null || aStartMin == null || aEndMin == null) {
    throw badRequest("Please enter times in HH:mm format.", ERROR_CODES.VALIDATION_ERROR);
  }
  const morningValid = mEndMin > mStartMin;
  const afternoonValid = aEndMin > aStartMin;
  if (!morningValid && !afternoonValid) {
    throw badRequest("The end time must be after the start time.", ERROR_CODES.VALIDATION_ERROR);
  }

  const catList = Array.isArray(categories) ? categories : [];
  const normalizedCats = [];
  for (const c of catList) {
    const key = c.categoryKey || c.key;
    if (!key) {
      throw badRequest("Every consultation category must be identified.", ERROR_CODES.VALIDATION_ERROR);
    }
    const def = getCategory(key);
    if (!def) {
      throw badRequest(`"${key}" is not a recognised consultation category.`, ERROR_CODES.VALIDATION_ERROR);
    }
    const dm = resolveDurationMinutes(key, c.durationMinutes);
    if (dm == null) {
      throw badRequest(`The duration set for "${key}" is not allowed for that category.`, ERROR_CODES.VALIDATION_ERROR);
    }
    normalizedCats.push({ categoryKey: key, durationMinutes: dm });
  }

  if (!normalizedCats.length) {
    throw badRequest(
      "Add at least one consultation category with a duration so slots can be generated.",
      ERROR_CODES.MISSING_FIELDS
    );
  }

  const doc = await MissionSchedule.create({
    date: day,
    morningStart,
    morningEnd,
    afternoonStart,
    afternoonEnd,
    categories: normalizedCats,
    createdBy: req.user.userId,
  });

  // Auto-assign pending queue into this newly created mission schedule.
  await processMissionSchedulePriorityQueue(doc._id, { staffId: req.user.userId });

  await createSystemLog({
    req,
    action: "SCHEDULE_CREATED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Mission schedule created",
    resource: "MissionSchedule",
    resourceId: String(doc._id),
    metadata: {
      date: doc.date ? new Date(doc.date).toISOString() : null,
      categoryCount: (doc.categories || []).length,
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Mission schedule created successfully.",
    missionSchedule: doc,
  });
});

exports.updateMissionSchedule = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "mission schedule");
  const { date, morning, afternoon, categories, startTime, endTime } = req.body;

  const mission = await MissionSchedule.findById(id);
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  const day = date != null ? normalizeDateInput(date) : mission.date;
  if (date != null && !day) {
    throw badRequest("Please provide a valid mission date.", ERROR_CODES.VALIDATION_ERROR);
  }

  // Duplicate check on edit (critical rule).
  const duplicate = await MissionSchedule.findOne({
    date: day,
    _id: { $ne: mission._id },
  }).lean();
  if (duplicate) {
    throw conflict("A mission schedule already exists for this date.", ERROR_CODES.DUPLICATE_SCHEDULE);
  }

  const morningStart =
    startTime != null ? String(startTime) : morning?.start || mission.morningStart;
  const morningEnd =
    endTime != null ? String(endTime) : morning?.end || mission.morningEnd;
  const afternoonStart =
    startTime != null && endTime != null ? String(endTime) : afternoon?.start || mission.afternoonStart;
  const afternoonEnd =
    startTime != null && endTime != null ? String(endTime) : afternoon?.end || mission.afternoonEnd;

  const mStartMin = parseHHMM(morningStart);
  const mEndMin = parseHHMM(morningEnd);
  const aStartMin = parseHHMM(afternoonStart);
  const aEndMin = parseHHMM(afternoonEnd);
  if (mStartMin == null || mEndMin == null || aStartMin == null || aEndMin == null) {
    throw badRequest("Please enter times in HH:mm format.", ERROR_CODES.VALIDATION_ERROR);
  }
  const morningValid = mEndMin > mStartMin;
  const afternoonValid = aEndMin > aStartMin;
  if (!morningValid && !afternoonValid) {
    throw badRequest("The end time must be after the start time.", ERROR_CODES.VALIDATION_ERROR);
  }

  const catList = Array.isArray(categories) ? categories : [];
  const normalizedCats = [];
  for (const c of catList) {
    const key = c.categoryKey || c.key;
    if (!key) {
      throw badRequest("Every consultation category must be identified.", ERROR_CODES.VALIDATION_ERROR);
    }
    const def = getCategory(key);
    if (!def) {
      throw badRequest(`"${key}" is not a recognised consultation category.`, ERROR_CODES.VALIDATION_ERROR);
    }
    const dm = resolveDurationMinutes(key, c.durationMinutes);
    if (dm == null) {
      throw badRequest(`The duration set for "${key}" is not allowed for that category.`, ERROR_CODES.VALIDATION_ERROR);
    }
    normalizedCats.push({ categoryKey: key, durationMinutes: dm });
  }

  if (!normalizedCats.length) {
    throw badRequest(
      "Add at least one consultation category with a duration so slots can be generated.",
      ERROR_CODES.MISSING_FIELDS
    );
  }

  mission.date = day;
  mission.morningStart = morningStart;
  mission.morningEnd = morningEnd;
  mission.afternoonStart = afternoonStart;
  mission.afternoonEnd = afternoonEnd;
  mission.categories = normalizedCats;
  await mission.save();

  // Validate and reset linked booked appointments if they no longer fit the updated schedule.
  const updatedMission = await MissionSchedule.findById(mission._id).lean();
  const windows = getMissionDayWindows(updatedMission);
  const categoryMap = new Map((updatedMission.categories || []).map((c) => [c.categoryKey, c.durationMinutes]));

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: ["confirmed", "rescheduled"] },
  });

  const pendingResetOps = [];
  for (const appt of booked) {
    const okSlot =
      appt.slotStart &&
      appt.slotEnd &&
      windows.length > 0 &&
      isIntervalInsideWindows(windows, appt.slotStart, appt.slotEnd);

    const key = appt.assignedCategoryKey;
    const expectedDuration = key ? categoryMap.get(key) : null;
    const okCategory =
      Boolean(key) &&
      expectedDuration != null &&
      Number(appt.assignedDurationMinutes) === Number(expectedDuration);

    if (okSlot && okCategory) continue;

    pendingResetOps.push({
      updateOne: {
        filter: { _id: appt._id },
        update: {
          $set: {
            status: "pending",
            missionSchedule: null,
            assignedCategoryKey: null,
            assignedDurationMinutes: null,
            slotStart: null,
            slotEnd: null,
            assignedBy: null,
            assignedAt: null,
          },
        },
      },
    });
  }

  if (pendingResetOps.length) {
    await Appointment.bulkWrite(pendingResetOps, { ordered: true });
  }

  // Re-fill the schedule with highest-priority pending appointments if anything was reset.
  await processMissionSchedulePriorityQueue(mission._id, { staffId: req.user.userId });

  await createSystemLog({
    req,
    action: "SCHEDULE_UPDATED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Mission schedule updated",
    resource: "MissionSchedule",
    resourceId: String(mission._id),
    metadata: {
      date: day ? new Date(day).toISOString() : null,
    },
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

  // Reset linked booked appointments back to Pending.
  const bookedStatuses = ["confirmed", "rescheduled"];
  await Appointment.updateMany(
    { missionSchedule: mission._id, status: { $in: bookedStatuses } },
    {
      $set: {
        status: "pending",
        missionSchedule: null,
        assignedCategoryKey: null,
        assignedDurationMinutes: null,
        slotStart: null,
        slotEnd: null,
        assignedBy: null,
        assignedAt: null,
        declineReason: "",
      },
    }
  );

  await MissionSchedule.deleteOne({ _id: mission._id });

  // Reprocess future schedules so pending appointments can be assigned again.
  await processUpcomingMissionSchedulesPriorityQueue({ staffId: req.user.userId });

  await createSystemLog({
    req,
    action: "SCHEDULE_DELETED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Mission schedule deleted",
    resource: "MissionSchedule",
    resourceId: String(mission._id),
    metadata: {
      date: mission.date ? new Date(mission.date).toISOString() : null,
    },
  });

  return res.json({
    success: true,
    message: "Mission schedule deleted successfully.",
    deleted: true,
  });
});

exports.listMissionSchedules = asyncHandler(async (req, res) => {
  const { date } = req.query;
  const filter = {};
  if (date) {
    const d = normalizeDateInput(date);
    if (!d) {
      throw badRequest("The date filter is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
    }
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    filter.date = { $gte: d, $lt: next };
  }

  const rows = await MissionSchedule.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  return res.json({
    success: true,
    message: "Mission schedules loaded successfully.",
    missionSchedules: rows,
  });
});

exports.getMissionSchedule = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "mission schedule");
  const mission = await MissionSchedule.findById(id).lean();
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: ["confirmed", "rescheduled"] },
  })
    .select("slotStart slotEnd assignedCategoryKey resident status")
    .populate("resident", "fullname email")
    .lean();

  return res.json({
    success: true,
    message: "Mission schedule loaded successfully.",
    missionSchedule: mission,
    bookedAppointments: booked,
  });
});

exports.getConsultationCategories = asyncHandler(async (_req, res) => {
  return res.json({
    success: true,
    message: "Consultation categories loaded successfully.",
    categories: CONSULTATION_CATEGORIES,
  });
});

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

  const def = getCategory(categoryKey);
  if (!def) {
    throw badRequest("That consultation category is not recognised.", ERROR_CODES.VALIDATION_ERROR);
  }

  const dm = resolveDurationMinutes(categoryKey, durationMinutes != null ? Number(durationMinutes) : undefined);
  if (dm == null) {
    throw badRequest("The requested duration is not allowed for that category.", ERROR_CODES.VALIDATION_ERROR);
  }

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: ["confirmed", "rescheduled"] },
  })
    .select("slotStart slotEnd")
    .lean();

  const slots = listAvailableStarts(mission, booked, dm, excludeAppointmentId || null);
  const suggested = suggestNextAvailableSlot(mission, booked, dm, excludeAppointmentId || null);

  return res.json({
    success: true,
    message: "Available slots computed.",
    durationMinutes: dm,
    availableSlotStarts: slots,
    suggestedNextSlotStart: suggested,
  });
});
