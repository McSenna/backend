"use strict";

const Appointment = require("../models/Appointment");
const MissionSchedule = require("../models/MissionSchedule");
const { ageToTier, computeAgeYears } = require("../utils/priorityQueue");
const { validateDurationForCategory } = require("../config/consultationCategories");
const { suggestNextAvailableSlot } = require("../utils/slotAvailability");

const BOOKED_STATUSES = ["confirmed", "rescheduled"];

function normalizeDayStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function computePriorityFromAppointmentDoc(appt, residentDOB) {
  const ageYears = computeAgeYears(residentDOB);
  const priorityTag = ageToTier(ageYears);
  return { ageYears, priorityTag };
}

async function tagPendingAppointments(pendingAppointments) {
  // Enforce strict triage tagging whenever we reprocess the queue.
  // This ensures sort order is always based on AGE, not stale stored values.
  const bulkOps = [];
  for (const appt of pendingAppointments) {
    const residentDOB = appt?.resident?.dateOfBirth;
    const { ageYears, priorityTag } = computePriorityFromAppointmentDoc(appt, residentDOB);

    bulkOps.push({
      updateOne: {
        filter: { _id: appt._id },
        update: {
          $set: {
            ageTier: priorityTag,
            prioritySortKey: priorityTag,
            ageAtSubmission: ageYears,
          },
        },
      },
    });

    // Also attach computed fields locally so our in-memory sorting uses fresh data.
    appt._computedPriorityTag = priorityTag;
    appt._computedAgeYears = ageYears;
  }

  if (bulkOps.length) {
    await Appointment.bulkWrite(bulkOps, { ordered: true });
  }
}

function buildMissionCategoryMap(mission) {
  const map = new Map();
  for (const c of mission.categories || []) {
    if (c?.categoryKey) map.set(c.categoryKey, c.durationMinutes);
  }
  return map;
}

/**
 * Assign as many pending appointments as possible into the mission schedule,
 * always in strict (priorityTag ASC, createdAt ASC) order.
 *
 * Safe mode: does NOT displace already-confirmed/rescheduled appointments.
 */
async function processMissionSchedulePriorityQueue(missionScheduleId, { staffId } = {}) {
  const mission = await MissionSchedule.findById(missionScheduleId).lean();
  if (!mission) {
    return { assigned: 0, missionScheduleId, reason: "Mission schedule not found" };
  }

  const missionCategoryMap = buildMissionCategoryMap(mission);

  // Existing confirmed/rescheduled bookings occupy time, so we must not conflict with them.
  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: BOOKED_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .lean();

  const bookedSim = booked.map((b) => ({
    _id: b._id,
    slotStart: b.slotStart,
    slotEnd: b.slotEnd,
  }));

  // Load all pending appointments and compute strict priority tags based on resident AGE.
  const pending = await Appointment.find({ status: "pending" })
    .populate("resident", "dateOfBirth")
    .select("consultationType createdAt ageTier prioritySortKey ageAtSubmission _id")
    .exec();

  if (!pending.length) return { assigned: 0, missionScheduleId };

  await tagPendingAppointments(pending);

  pending.sort((a, b) => {
    const pa = a._computedPriorityTag ?? a.prioritySortKey ?? 4;
    const pb = b._computedPriorityTag ?? b.prioritySortKey ?? 4;
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const now = new Date();
  let assigned = 0;

  for (const appt of pending) {
    const categoryKey = appt.consultationType;
    const missionDurationMinutes = missionCategoryMap.get(categoryKey);
    if (!missionDurationMinutes) continue; // No matching slot category on this mission.

    const v = validateDurationForCategory(categoryKey, missionDurationMinutes);
    if (!v.ok) continue;

    // Find earliest available start time for this appointment category/duration.
    const slotStartIso = suggestNextAvailableSlot(mission, bookedSim, v.durationMinutes, null);
    if (!slotStartIso) continue; // Matching time slot not available.

    const slotStartDate = new Date(slotStartIso);
    const slotEndDate = new Date(slotStartDate.getTime() + v.durationMinutes * 60 * 1000);

    // Claim-and-assign atomically so we don't confirm a previously-taken "pending" appointment.
    const updated = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: "pending" },
      {
        $set: {
          // Re-apply computed strict triage data (so the stored tag stays correct).
          ageTier: appt._computedPriorityTag ?? appt.prioritySortKey,
          prioritySortKey: appt._computedPriorityTag ?? appt.prioritySortKey,
          ageAtSubmission: appt._computedAgeYears ?? appt.ageAtSubmission,

          missionSchedule: mission._id,
          assignedCategoryKey: categoryKey,
          assignedDurationMinutes: v.durationMinutes,
          slotStart: slotStartDate,
          slotEnd: slotEndDate,
          assignedBy: staffId ?? null,
          assignedAt: now,
          status: "confirmed",
        },
      },
      { new: true }
    );

    if (!updated) continue; // Someone else assigned it first.

    bookedSim.push({
      _id: updated._id,
      slotStart: slotStartDate,
      slotEnd: slotEndDate,
    });
    assigned += 1;
  }

  return { assigned, missionScheduleId };
}

/**
 * Finds the first pending appointment that can be assigned into the mission schedule
 * without conflicting with existing booked slots.
 *
 * Used to enforce strict "never assign a lower priority before a higher priority".
 */
async function getFirstAssignablePendingAppointmentForMission(missionScheduleId) {
  const mission = await MissionSchedule.findById(missionScheduleId).lean();
  if (!mission) return null;
  const missionCategoryMap = buildMissionCategoryMap(mission);

  const booked = await Appointment.find({
    missionSchedule: mission._id,
    status: { $in: BOOKED_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .lean();

  const bookedSim = booked.map((b) => ({
    _id: b._id,
    slotStart: b.slotStart,
    slotEnd: b.slotEnd,
  }));

  const pending = await Appointment.find({ status: "pending" })
    .populate("resident", "dateOfBirth")
    .select("consultationType createdAt ageTier prioritySortKey ageAtSubmission _id")
    .exec();

  if (!pending.length) return null;

  await tagPendingAppointments(pending);

  pending.sort((a, b) => {
    const pa = a._computedPriorityTag ?? a.prioritySortKey ?? 4;
    const pb = b._computedPriorityTag ?? b.prioritySortKey ?? 4;
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const appt of pending) {
    const categoryKey = appt.consultationType;
    const missionDurationMinutes = missionCategoryMap.get(categoryKey);
    if (!missionDurationMinutes) continue;

    const v = validateDurationForCategory(categoryKey, missionDurationMinutes);
    if (!v.ok) continue;

    const slotStartIso = suggestNextAvailableSlot(mission, bookedSim, v.durationMinutes, null);
    if (!slotStartIso) continue;

    return {
      appointmentId: appt._id,
      priorityTag: appt._computedPriorityTag ?? appt.prioritySortKey,
      categoryKey,
      durationMinutes: v.durationMinutes,
      suggestedSlotStart: slotStartIso,
    };
  }

  return null;
}

/**
 * Reprocesses triage across all upcoming mission schedules.
 * Safe mode only assigns pending appointments to open time slots.
 */
async function processUpcomingMissionSchedulesPriorityQueue({ staffId } = {}) {
  const today = normalizeDayStart(new Date());

  const missions = await MissionSchedule.find({ date: { $gte: today } })
    .sort({ date: 1, createdAt: 1 })
    .select("_id")
    .lean();

  let totalAssigned = 0;
  for (const m of missions) {
    const r = await processMissionSchedulePriorityQueue(m._id, { staffId });
    totalAssigned += r.assigned || 0;
    const remaining = await Appointment.countDocuments({ status: "pending" });
    if (remaining === 0) break;
  }

  return { totalAssigned };
}

module.exports = {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
  getFirstAssignablePendingAppointmentForMission,
};

