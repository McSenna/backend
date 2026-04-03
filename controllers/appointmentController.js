"use strict";

const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const MissionSchedule = require("../models/MissionSchedule");
const User = require("../models/User");
const { getCategory, validateDurationForCategory } = require("../config/consultationCategories");
const { computeAgeYears, ageToTier } = require("../utils/priorityQueue");
const {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
  getFirstAssignablePendingAppointmentForMission,
} = require("../services/triageQueue");
const {
  getMissionDayWindows,
  isIntervalInsideWindows,
  hasConflict,
  suggestNextAvailableSlot,
} = require("../utils/slotAvailability");
const { sendAppointmentConfirmationEmail, sendNotificationEmail } = require("../services/mailer");

const STAFF_ROLES = ["doctor", "admin", "midwife"];
const BOOKED_STATUSES = ["confirmed", "rescheduled"];

async function loadBookedForMission(missionId, excludeId) {
  return Appointment.find({
    missionSchedule: missionId,
    status: { $in: BOOKED_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .lean();
}

function formatAppointmentDetails(slotStart, workerLabel, locationLabel) {
  const d = new Date(slotStart);
  return {
    date: d.toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
    worker: workerLabel || "Medical mission team",
    location: locationLabel || "Barangay health mission site",
  };
}

exports.createAppointment = async (req, res) => {
  try {
    const { consultationType, description, isUrgent } = req.body;
    if (!consultationType) {
      return res.status(400).json({ success: false, message: "consultationType is required" });
    }
    const key = String(consultationType).trim();
    if (!getCategory(key)) {
      return res.status(400).json({ success: false, message: "Invalid consultation type" });
    }

    const user = await User.findById(req.user.userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const age = computeAgeYears(user.dateOfBirth);
    const priorityTag = ageToTier(age);

    const appt = await Appointment.create({
      resident: user._id,
      consultationType: key,
      description: typeof description === "string" ? description.trim().slice(0, 4000) : "",
      isUrgent: Boolean(isUrgent),
      status: "pending",
      ageTier: priorityTag,
      prioritySortKey: priorityTag,
      ageAtSubmission: age,
    });

    // Reprocess queue so the new appointment is triaged immediately (priority + FIFO).
    // In auto-assign flow we do not have a staff actor, so assignedBy remains null.
    await processUpcomingMissionSchedulesPriorityQueue({ staffId: null });

    const populated = await Appointment.findById(appt._id)
      .populate("resident", "fullname email dateOfBirth")
      .populate("missionSchedule", "date morningStart morningEnd afternoonStart afternoonEnd")
      .lean();

    return res.status(201).json({
      success: true,
      message:
        "Your appointment is in queue. Please wait for the doctor to assign your schedule.",
      appointment: populated,
    });
  } catch (err) {
    console.error("createAppointment:", err);
    return res.status(500).json({ success: false, message: "Failed to create appointment" });
  }
};

exports.getMyAppointments = async (req, res) => {
  try {
    const list = await Appointment.find({ resident: req.user.userId })
      .sort({ createdAt: -1 })
      .populate("missionSchedule", "date morningStart morningEnd afternoonStart afternoonEnd")
      .populate("assignedBy", "fullname role")
      .lean();
    return res.json({ success: true, appointments: list });
  } catch (err) {
    console.error("getMyAppointments:", err);
    return res.status(500).json({ success: false, message: "Failed to load appointments" });
  }
};

exports.getPendingAppointments = async (req, res) => {
  try {
    const pending = await Appointment.find({ status: "pending" })
      .populate("resident", "fullname email dateOfBirth gender")
      .lean();

    const bulkOps = [];
    for (const appt of pending) {
      const age = computeAgeYears(appt.resident?.dateOfBirth);
      const priorityTag = ageToTier(age);

      const shouldUpdate =
        appt.ageTier !== priorityTag ||
        appt.prioritySortKey !== priorityTag ||
        appt.ageAtSubmission !== age;

      if (shouldUpdate) {
        bulkOps.push({
          updateOne: {
            filter: { _id: appt._id },
            update: {
              $set: {
                ageTier: priorityTag,
                prioritySortKey: priorityTag,
                ageAtSubmission: age,
              },
            },
          },
        });
      }

      // Ensure response sorting uses freshly computed strict triage tags.
      appt.ageTier = priorityTag;
      appt.prioritySortKey = priorityTag;
      appt.ageAtSubmission = age;
    }

    if (bulkOps.length) {
      await Appointment.bulkWrite(bulkOps, { ordered: true });
    }

    pending.sort((a, b) => {
      if (a.prioritySortKey !== b.prioritySortKey) return a.prioritySortKey - b.prioritySortKey;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return res.json({ success: true, appointments: pending });
  } catch (err) {
    console.error("getPendingAppointments:", err);
    return res.status(500).json({ success: false, message: "Failed to load pending queue" });
  }
};

exports.listAppointments = async (req, res) => {
  try {
    const { status, missionScheduleId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (missionScheduleId && mongoose.isValidObjectId(missionScheduleId)) {
      filter.missionSchedule = missionScheduleId;
    }

    const list = await Appointment.find(filter)
      .sort({ createdAt: -1 })
      .populate("resident", "fullname email dateOfBirth")
      .populate("missionSchedule", "date")
      .lean();

    return res.json({ success: true, appointments: list });
  } catch (err) {
    console.error("listAppointments:", err);
    return res.status(500).json({ success: false, message: "Failed to list appointments" });
  }
};

exports.getAnalyticsByCategory = async (req, res) => {
  try {
    const { missionScheduleId } = req.query;
    const match = {};
    if (missionScheduleId && mongoose.isValidObjectId(missionScheduleId)) {
      match.missionSchedule = new mongoose.Types.ObjectId(missionScheduleId);
    }

    const pipeline = [
      { $match: Object.keys(match).length ? match : {} },
      {
        $group: {
          _id: {
            category: {
              $ifNull: ["$assignedCategoryKey", "$consultationType"],
            },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
    ];

    const rows = await Appointment.aggregate(pipeline);
    return res.json({ success: true, analytics: rows });
  } catch (err) {
    console.error("getAnalyticsByCategory:", err);
    return res.status(500).json({ success: false, message: "Failed to load analytics" });
  }
};

async function validateAndAssignSlot({ appointment, mission, categoryKey, durationMinutes, slotStart, staffId, isReassign }) {
  const v = validateDurationForCategory(categoryKey, durationMinutes);
  if (!v.ok) {
    return { error: v.message };
  }
  const slotStartDate = new Date(slotStart);
  if (Number.isNaN(slotStartDate.getTime())) {
    return { error: "Invalid slotStart" };
  }
  const slotEndDate = new Date(slotStartDate.getTime() + v.durationMinutes * 60 * 1000);

  const windows = getMissionDayWindows(mission);
  if (!windows.length) {
    return { error: "Mission has no valid time windows" };
  }
  if (!isIntervalInsideWindows(windows, slotStartDate, slotEndDate)) {
    return { error: "Slot does not fit within mission morning/afternoon windows" };
  }

  const booked = await loadBookedForMission(mission._id, appointment._id);
  if (hasConflict(booked, slotStartDate, slotEndDate, String(appointment._id))) {
    return { error: "Slot overlaps an existing booking" };
  }

  const hadSlot = Boolean(appointment.slotStart && appointment.missionSchedule);

  appointment.missionSchedule = mission._id;
  appointment.assignedCategoryKey = categoryKey;
  appointment.assignedDurationMinutes = v.durationMinutes;
  appointment.slotStart = slotStartDate;
  appointment.slotEnd = slotEndDate;
  appointment.assignedBy = staffId;
  appointment.assignedAt = new Date();

  if (isReassign && hadSlot) {
    appointment.status = "rescheduled";
  } else {
    appointment.status = "confirmed";
  }

  await appointment.save();
  return { appointment };
}

exports.assignAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { missionScheduleId, categoryKey, durationMinutes, slotStart } = req.body;

    if (!missionScheduleId || !categoryKey || !slotStart) {
      return res.status(400).json({
        success: false,
        message: "missionScheduleId, categoryKey, and slotStart are required",
      });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }
    if (appointment.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only pending appointments can be assigned via this action" });
    }

    const mission = await MissionSchedule.findById(missionScheduleId);
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
    }

    if (String(appointment.consultationType) !== String(categoryKey)) {
      return res.status(400).json({
        success: false,
        message: "categoryKey must match the appointment consultation type",
      });
    }

    const missionCat = mission.categories?.find((c) => c.categoryKey === categoryKey);
    if (!missionCat) {
      return res.status(400).json({ success: false, message: "This mission has no slot for categoryKey" });
    }

    // Strict enforcement: only allow assigning the next triage appointment that is actually assignable.
    const next = await getFirstAssignablePendingAppointmentForMission(missionScheduleId);
    if (!next) {
      return res.status(400).json({ success: false, message: "No assignable pending appointment found" });
    }
    if (String(next.appointmentId) !== String(appointment._id)) {
      return res.status(409).json({
        success: false,
        message: "Strict triage violation: assign the next higher-priority appointment first.",
      });
    }

    const result = await validateAndAssignSlot({
      appointment,
      mission,
      categoryKey,
      // Enforce the mission schedule's configured duration for this category.
      durationMinutes: missionCat.durationMinutes,
      slotStart,
      staffId: req.user.userId,
      isReassign: false,
    });

    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    const populated = await Appointment.findById(appointment._id)
      .populate("resident", "fullname email")
      .populate("missionSchedule")
      .lean();

    const resident = populated.resident;
    if (resident?.email) {
      try {
        await sendAppointmentConfirmationEmail(
          resident.email,
          resident.fullname,
          formatAppointmentDetails(populated.slotStart, null, null)
        );
      } catch (e) {
        console.warn("Confirmation email skipped:", e.message);
      }
    }

    // Fill any additional open slots using strict priority triage.
    try {
      await processMissionSchedulePriorityQueue(missionScheduleId, { staffId: req.user.userId });
    } catch (e) {
      console.warn("queue reprocess after assign failed:", e.message);
    }

    return res.json({
      success: true,
      message: "Appointment confirmed and scheduled",
      appointment: populated,
    });
  } catch (err) {
    console.error("assignAppointment:", err);
    return res.status(500).json({ success: false, message: "Failed to assign appointment" });
  }
};

exports.reassignAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { missionScheduleId, categoryKey, durationMinutes, slotStart } = req.body;

    if (!missionScheduleId || !categoryKey || !slotStart) {
      return res.status(400).json({
        success: false,
        message: "missionScheduleId, categoryKey, and slotStart are required",
      });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }
    if (!BOOKED_STATUSES.includes(appointment.status)) {
      return res.status(400).json({ success: false, message: "Only confirmed or rescheduled appointments can be reassigned" });
    }

    const mission = await MissionSchedule.findById(missionScheduleId);
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
    }

    const result = await validateAndAssignSlot({
      appointment,
      mission,
      categoryKey,
      durationMinutes,
      slotStart,
      staffId: req.user.userId,
      isReassign: true,
    });

    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    const populated = await Appointment.findById(appointment._id)
      .populate("resident", "fullname email")
      .populate("missionSchedule")
      .lean();

    const resident = populated.resident;
    if (resident?.email) {
      try {
        await sendNotificationEmail(resident.email, resident.fullname);
      } catch (e) {
        console.warn("Reschedule notification email skipped:", e.message);
      }
    }

    // Fill any additional open slots using strict priority triage.
    try {
      await processMissionSchedulePriorityQueue(missionScheduleId, { staffId: req.user.userId });
    } catch (e) {
      console.warn("queue reprocess after reassign failed:", e.message);
    }

    return res.json({
      success: true,
      message: "Appointment rescheduled",
      appointment: populated,
    });
  } catch (err) {
    console.error("reassignAppointment:", err);
    return res.status(500).json({ success: false, message: "Failed to reassign appointment" });
  }
};

exports.rejectAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    const freedMissionScheduleId = appointment.missionSchedule;

    if (appointment.status === "declined") {
      return res.json({ success: true, message: "Already declined", appointment });
    }
    if (!["pending", "confirmed", "rescheduled"].includes(appointment.status)) {
      return res.status(400).json({ success: false, message: "Cannot reject this appointment" });
    }

    appointment.status = "declined";
    appointment.declineReason = typeof reason === "string" ? reason.slice(0, 1000) : "";
    appointment.missionSchedule = null;
    appointment.slotStart = null;
    appointment.slotEnd = null;
    appointment.assignedCategoryKey = null;
    appointment.assignedDurationMinutes = null;
    await appointment.save();

    const populated = await Appointment.findById(appointment._id)
      .populate("resident", "fullname email")
      .lean();

    if (freedMissionScheduleId) {
      try {
        await processMissionSchedulePriorityQueue(freedMissionScheduleId, { staffId: req.user.userId });
      } catch (e) {
        console.warn("queue reprocess after reject failed:", e.message);
      }
    }

    return res.json({ success: true, message: "Appointment declined", appointment: populated });
  } catch (err) {
    console.error("rejectAppointment:", err);
    return res.status(500).json({ success: false, message: "Failed to reject appointment" });
  }
};

exports.suggestSlot = async (req, res) => {
  try {
    const { missionScheduleId, categoryKey, durationMinutes, excludeAppointmentId } = req.query;
    if (!missionScheduleId || !categoryKey) {
      return res.status(400).json({ success: false, message: "missionScheduleId and categoryKey are required" });
    }
    const mission = await MissionSchedule.findById(missionScheduleId).lean();
    if (!mission) {
      return res.status(404).json({ success: false, message: "Mission schedule not found" });
    }
    const v = validateDurationForCategory(categoryKey, durationMinutes != null ? Number(durationMinutes) : undefined);
    if (!v.ok) {
      return res.status(400).json({ success: false, message: v.message });
    }
    const booked = await loadBookedForMission(mission._id, excludeAppointmentId || null);
    const next = suggestNextAvailableSlot(mission, booked, v.durationMinutes, excludeAppointmentId || null);
    return res.json({ success: true, suggestedNextSlotStart: next, durationMinutes: v.durationMinutes });
  } catch (err) {
    console.error("suggestSlot:", err);
    return res.status(500).json({ success: false, message: "Failed to suggest slot" });
  }
};

exports.STAFF_ROLES = STAFF_ROLES;
