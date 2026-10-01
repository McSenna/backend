"use strict";

const Appointment = require("../models/Appointment");
const MissionSchedule = require("../models/MissionSchedule");
const User = require("../models/User");
const { loadMissionQueue, planSlotFor } = require("./triage/missionQueueContext");
const { announceAutoConfirm } = require("./triage/autoConfirmNotifier");
const { loadBookedForMission } = require("./appointment/slotService");
const { withMissionSlotLock } = require("./appointment/slotLock");

const normalizeDayStart = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const claimPendingAppointment = ({ appointment, mission, missionCategoryMap, staffId, now }) =>
  withMissionSlotLock(mission._id, async (session) => {
    // Plan against the slots committed right now, not the snapshot the queue was
    // ranked from: a reschedule or staff booking may have taken a slot since.
    const booked = await loadBookedForMission(mission._id, session);
    const plan = planSlotFor({ appointment, mission, missionCategoryMap, bookedSim: booked });
    if (!plan) return null;

    const slotStart = new Date(plan.slotStartIso);
    const slotEnd = new Date(slotStart.getTime() + plan.durationMinutes * 60 * 1000);

    return Appointment.findOneAndUpdate(
      { _id: appointment._id, status: "pending" },
      {
        $set: {
          ageTier: appointment.ageTier,
          prioritySortKey: appointment.prioritySortKey,
          ageAtSubmission: appointment.ageAtSubmission,

          missionSchedule: mission._id,
          assignedCategoryKey: plan.categoryKey,
          assignedDurationMinutes: plan.durationMinutes,
          slotStart,
          slotEnd,
          assignedBy: staffId ?? null,
          assignedAt: now,
          status: "confirmed",
        },
      },
      { returnDocument: "after", session }
    );
  });

const processMissionSchedulePriorityQueue = async (missionScheduleId, { staffId } = {}) => {
  const queue = await loadMissionQueue(missionScheduleId, "dateOfBirth fullname email");
  if (!queue) {
    return { assigned: 0, missionScheduleId, reason: "Mission schedule not found" };
  }

  const { mission, missionCategoryMap, bookedSim, pending } = queue;
  if (!pending.length) return { assigned: 0, missionScheduleId };

  const staffUser = staffId ? await User.findById(staffId).lean() : null;
  const doctorLabel = staffUser?.fullname ?? null;
  const now = new Date();
  let assigned = 0;

  for (const appointment of pending) {
    // Cheap pre-check on the snapshot; the claim re-plans under the lock.
    if (!planSlotFor({ appointment, mission, missionCategoryMap, bookedSim })) continue;

    const updated = await claimPendingAppointment({ appointment, mission, missionCategoryMap, staffId, now });
    if (!updated) continue;

    announceAutoConfirm({ appointment, updated, staffId, doctorLabel });

    bookedSim.push({
      _id: updated._id,
      slotStart: updated.slotStart,
      slotEnd: updated.slotEnd,
    });
    assigned += 1;
  }

  return { assigned, missionScheduleId };
};

const getFirstAssignablePendingAppointmentForMission = async (missionScheduleId) => {
  const queue = await loadMissionQueue(missionScheduleId, "dateOfBirth");
  if (!queue) return null;

  const { mission, missionCategoryMap, bookedSim, pending } = queue;
  if (!pending.length) return null;

  for (const appointment of pending) {
    const plan = planSlotFor({ appointment, mission, missionCategoryMap, bookedSim });
    if (!plan) continue;

    return {
      appointmentId: appointment._id,
      priorityTag: appointment.prioritySortKey,
      categoryKey: plan.categoryKey,
      durationMinutes: plan.durationMinutes,
      suggestedSlotStart: plan.slotStartIso,
    };
  }

  return null;
};

const processUpcomingMissionSchedulesPriorityQueue = async ({ staffId } = {}) => {
  const today = normalizeDayStart(new Date());

  const missions = await MissionSchedule.find({ date: { $gte: today } })
    .sort({ date: 1, createdAt: 1 })
    .select("_id")
    .lean();

  let totalAssigned = 0;
  for (const mission of missions) {
    const result = await processMissionSchedulePriorityQueue(mission._id, { staffId });
    totalAssigned += result.assigned || 0;
    if ((await Appointment.countDocuments({ status: "pending" })) === 0) break;
  }

  return { totalAssigned };
};

module.exports = {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
  getFirstAssignablePendingAppointmentForMission,
};
