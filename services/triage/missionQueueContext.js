"use strict";

const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const { validateDurationForCategory } = require("../../config/consultationCategories");
const { suggestNextAvailableSlot } = require("../../utils/slotAvailability");
const { tagPendingAppointments, byPriorityThenCreated } = require("./triagePriority");
const { SLOT_OCCUPYING_STATUSES } = require("../queueScope");

const PENDING_SELECT = "consultationType createdAt ageTier prioritySortKey ageAtSubmission _id";

const buildMissionCategoryMap = (mission) => {
  const map = new Map();
  for (const category of mission.categories || []) {
    if (category?.categoryKey) map.set(category.categoryKey, category.durationMinutes);
  }
  return map;
};

const loadBookedSimulation = async (missionId) => {
  const booked = await Appointment.find({
    missionSchedule: missionId,
    status: { $in: SLOT_OCCUPYING_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .lean();

  return booked.map((entry) => ({
    _id: entry._id,
    slotStart: entry.slotStart,
    slotEnd: entry.slotEnd,
  }));
};

const loadRankedPending = async (residentFields) => {
  const pending = await Appointment.find({ status: "pending" })
    .populate("resident", residentFields)
    .select(PENDING_SELECT)
    .exec();

  if (!pending.length) return pending;

  await tagPendingAppointments(pending);
  pending.sort(byPriorityThenCreated);
  return pending;
};

const loadMissionQueue = async (missionScheduleId, residentFields) => {
  const mission = await MissionSchedule.findById(missionScheduleId).lean();
  if (!mission) return null;

  return {
    mission,
    missionCategoryMap: buildMissionCategoryMap(mission),
    bookedSim: await loadBookedSimulation(mission._id),
    pending: await loadRankedPending(residentFields),
  };
};

const planSlotFor = ({ appointment, mission, missionCategoryMap, bookedSim }) => {
  const categoryKey = appointment.consultationType;
  const missionDurationMinutes = missionCategoryMap.get(categoryKey);
  if (!missionDurationMinutes) return null;

  const validated = validateDurationForCategory(categoryKey, missionDurationMinutes);
  if (!validated.ok) return null;

  const slotStartIso = suggestNextAvailableSlot(mission, bookedSim, validated.durationMinutes, null);
  if (!slotStartIso) return null;

  return { categoryKey, durationMinutes: validated.durationMinutes, slotStartIso };
};

module.exports = { loadMissionQueue, planSlotFor };
