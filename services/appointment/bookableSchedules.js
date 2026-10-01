"use strict";

const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const { listOpenStarts } = require("../../utils/slotAvailability");
const { SLOT_OCCUPYING_STATUSES } = require("../queueScope");
const { missionDurationFor } = require("./slotService");
const { isServiceDay } = require("./serviceDayRules");

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const groupBookedByMission = (rows) => {
  const byMission = new Map();
  for (const row of rows) {
    const key = String(row.missionSchedule);
    if (!byMission.has(key)) byMission.set(key, []);
    byMission.get(key).push(row);
  }
  return byMission;
};

const loadBookedForMissions = async (missionIds) => {
  if (!missionIds.length) return new Map();

  const rows = await Appointment.find({
    missionSchedule: { $in: missionIds },
    status: { $in: SLOT_OCCUPYING_STATUSES },
  })
    .select("_id missionSchedule slotStart slotEnd")
    .lean();

  return groupBookedByMission(rows);
};

const buildScheduleOption = ({ mission, booked, categoryKey, excludeAppointmentId, nowTime }) => {
  const durationMinutes = missionDurationFor(mission, categoryKey);

  return {
    missionScheduleId: String(mission._id),
    date: mission.date,
    morningStart: mission.morningStart,
    morningEnd: mission.morningEnd,
    afternoonStart: mission.afternoonStart,
    afternoonEnd: mission.afternoonEnd,
    durationMinutes,
    availableSlotStarts: listOpenStarts(mission, booked, durationMinutes, excludeAppointmentId, nowTime),
  };
};

/**
 * Upcoming mission days that run `categoryKey`, each with its still-open start
 * times. Booking and rescheduling both offer exactly these, and the write path
 * re-checks the chosen start under the mission lock.
 *
 * Only missions that run this service can take the booking; any other mission
 * would drop it back to pending the next time that mission is edited. The day
 * filter drops older missions that list a fixed-day service on the wrong day.
 */
const listBookableSchedules = async ({ categoryKey, excludeAppointmentId = null }) => {
  const missions = (
    await MissionSchedule.find({
      date: { $gte: startOfToday() },
      "categories.categoryKey": categoryKey,
    })
      .sort({ date: 1 })
      .lean()
  ).filter((mission) => isServiceDay(categoryKey, mission.date));

  const bookedByMission = await loadBookedForMissions(missions.map((mission) => mission._id));
  const nowTime = Date.now();

  return missions.map((mission) =>
    buildScheduleOption({
      mission,
      booked: bookedByMission.get(String(mission._id)) ?? [],
      categoryKey,
      excludeAppointmentId: excludeAppointmentId ? String(excludeAppointmentId) : null,
      nowTime,
    })
  );
};

module.exports = { listBookableSchedules };
