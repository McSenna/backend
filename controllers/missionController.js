"use strict";

const MissionSchedule = require("../models/MissionSchedule");
const Appointment = require("../models/Appointment");
const { CONSULTATION_CATEGORIES, getCategory, resolveDurationMinutes } = require("../config/consultationCategories");
const { parseHHMM, listAvailableStarts, suggestNextAvailableSlot, getMissionDayWindows, isIntervalInsideWindows } = require("../utils/slotAvailability");
const {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
} = require("../services/triageQueue");

function normalizeDateInput(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  x.setHours(0, 0, 0, 0);
  return x;
}

exports.createMissionSchedule = async (req, res) => {
  try {
    const { date, morning, afternoon, categories, startTime, endTime } = req.body;
    if (!date) {
      return res.status(400).json({ success: false, message: "date is required" });
    }

    const day = normalizeDateInput(date);
    if (!day) {
      return res.status(400).json({ success: false, message: "Invalid date" });
    }

    // Critical rule: never allow duplicate mission schedules on the same day.
    const existing = await MissionSchedule.findOne({ date: day }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: "A mission schedule already exists for this date." });
    }

    const morningStart =
      startTime != null ? String(startTime) : morning?.start || "08:00";
    const morningEnd =
      endTime != null ? String(endTime) : morning?.end || "12:00";
    // If startTime/endTime are provided, we treat it as a single continuous time range.
    // We disable the afternoon window by making it zero-length (end <= start).
    const afternoonStart = startTime != null && endTime != null ? String(endTime) : afternoon?.start || "13:00";
    const afternoonEnd = startTime != null && endTime != null ? String(endTime) : afternoon?.end || "17:00";

    const mStartMin = parseHHMM(morningStart);
    const mEndMin = parseHHMM(morningEnd);
    const aStartMin = parseHHMM(afternoonStart);
    const aEndMin = parseHHMM(afternoonEnd);
    if (mStartMin == null || mEndMin == null || aStartMin == null || aEndMin == null) {
      return res.status(400).json({ success: false, message: "Invalid time format. Use HH:mm" });
    }
    const morningValid = mEndMin > mStartMin;
    const afternoonValid = aEndMin > aStartMin;
    if (!morningValid && !afternoonValid) {
      return res.status(400).json({ success: false, message: "Invalid time range. End time must be after start time." });
    }

    const catList = Array.isArray(categories) ? categories : [];
    const normalizedCats = [];
    for (const c of catList) {
      const key = c.categoryKey || c.key;
      if (!key) {
        return res.status(400).json({ success: false, message: "Each category needs categoryKey" });
      }
      const def = getCategory(key);
      if (!def) {
        return res.status(400).json({ success: false, message: `Unknown category: ${key}` });
      }
      const dm = resolveDurationMinutes(key, c.durationMinutes);
      if (dm == null) {
        return res.status(400).json({ success: false, message: `Invalid duration for ${key}` });
      }
      normalizedCats.push({ categoryKey: key, durationMinutes: dm });
    }

    if (!normalizedCats.length) {
      return res.status(400).json({
        success: false,
        message: "At least one category with duration is required for slot generation",
      });
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

    return res.status(201).json({ success: true, missionSchedule: doc });
  } catch (err) {
    console.error("createMissionSchedule:", err);
    return res.status(500).json({ success: false, message: "Failed to create mission schedule" });
  }
};

exports.updateMissionSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, morning, afternoon, categories, startTime, endTime } = req.body;

    const mission = await MissionSchedule.findById(id);
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
    }

    const day = date != null ? normalizeDateInput(date) : mission.date;
    if (date != null && !day) {
      return res.status(400).json({ success: false, message: "Invalid date" });
    }

    // Duplicate check on edit (critical rule).
    const duplicate = await MissionSchedule.findOne({
      date: day,
      _id: { $ne: mission._id },
    }).lean();
    if (duplicate) {
      return res.status(409).json({ success: false, message: "A mission schedule already exists for this date." });
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
      return res.status(400).json({ success: false, message: "Invalid time format. Use HH:mm" });
    }
    const morningValid = mEndMin > mStartMin;
    const afternoonValid = aEndMin > aStartMin;
    if (!morningValid && !afternoonValid) {
      return res.status(400).json({ success: false, message: "Invalid time range. End time must be after start time." });
    }

    const catList = Array.isArray(categories) ? categories : [];
    const normalizedCats = [];
    for (const c of catList) {
      const key = c.categoryKey || c.key;
      if (!key) {
        return res.status(400).json({ success: false, message: "Each category needs categoryKey" });
      }
      const def = getCategory(key);
      if (!def) {
        return res.status(400).json({ success: false, message: `Unknown category: ${key}` });
      }
      const dm = resolveDurationMinutes(key, c.durationMinutes);
      if (dm == null) {
        return res.status(400).json({ success: false, message: `Invalid duration for ${key}` });
      }
      normalizedCats.push({ categoryKey: key, durationMinutes: dm });
    }

    if (!normalizedCats.length) {
      return res.status(400).json({
        success: false,
        message: "At least one category with duration is required for slot generation",
      });
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

    return res.json({ success: true, missionSchedule: await MissionSchedule.findById(mission._id).lean() });
  } catch (err) {
    console.error("updateMissionSchedule:", err);
    return res.status(500).json({ success: false, message: "Failed to update mission schedule" });
  }
};

exports.deleteMissionSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const mission = await MissionSchedule.findById(id);
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
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

    return res.json({ success: true, deleted: true });
  } catch (err) {
    console.error("deleteMissionSchedule:", err);
    return res.status(500).json({ success: false, message: "Failed to delete mission schedule" });
  }
};

exports.listMissionSchedules = async (req, res) => {
  try {
    const { date } = req.query;
    const filter = {};
    if (date) {
      const d = normalizeDateInput(date);
      if (!d) {
        return res.status(400).json({ success: false, message: "Invalid date query" });
      }
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      filter.date = { $gte: d, $lt: next };
    }

    const rows = await MissionSchedule.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    return res.json({ success: true, missionSchedules: rows });
  } catch (err) {
    console.error("listMissionSchedules:", err);
    return res.status(500).json({ success: false, message: "Failed to list mission schedules" });
  }
};

exports.getMissionSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const mission = await MissionSchedule.findById(id).lean();
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
    }

    const booked = await Appointment.find({
      missionSchedule: mission._id,
      status: { $in: ["confirmed", "rescheduled"] },
    })
      .select("slotStart slotEnd assignedCategoryKey resident status")
      .populate("resident", "fullname email")
      .lean();

    return res.json({ success: true, missionSchedule: mission, bookedAppointments: booked });
  } catch (err) {
    console.error("getMissionSchedule:", err);
    return res.status(500).json({ success: false, message: "Failed to load mission schedule" });
  }
};

exports.getConsultationCategories = async (_req, res) => {
  return res.json({ success: true, categories: CONSULTATION_CATEGORIES });
};

exports.getAvailableSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryKey, durationMinutes, excludeAppointmentId } = req.query;

    if (!categoryKey) {
      return res.status(400).json({ success: false, message: "categoryKey is required" });
    }

    const mission = await MissionSchedule.findById(id).lean();
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
    }

    const def = getCategory(categoryKey);
    if (!def) {
      return res.status(400).json({ success: false, message: "Unknown category" });
    }

    const dm = resolveDurationMinutes(categoryKey, durationMinutes != null ? Number(durationMinutes) : undefined);
    if (dm == null) {
      return res.status(400).json({ success: false, message: "Invalid duration for category" });
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
      durationMinutes: dm,
      availableSlotStarts: slots,
      suggestedNextSlotStart: suggested,
    });
  } catch (err) {
    console.error("getAvailableSlots:", err);
    return res.status(500).json({ success: false, message: "Failed to compute available slots" });
  }
};
