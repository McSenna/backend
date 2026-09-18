"use strict";

const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const { loadAppointmentOrFail } = require("../appointmentLookup");
const { resolveDurationMinutes } = require("../../config/consultationCategories");
const { listAvailableStarts } = require("../../utils/slotAvailability");
const {
  RESCHEDULABLE_STATUSES,
  SLOT_OCCUPYING_STATUSES,
  assertOwnership,
  assertStatusAllows,
} = require("./shared");

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

const buildScheduleOption = ({ mission, booked, appointment, nowTime }) => {
  const missionCategory = mission.categories?.find(
    (category) => category.categoryKey === appointment.consultationType
  );

  const durationMinutes =
    missionCategory?.durationMinutes ||
    resolveDurationMinutes(appointment.consultationType) ||
    30;

  const availableSlotStarts = listAvailableStarts(
    mission,
    booked,
    durationMinutes,
    String(appointment._id)
  ).filter((startIso) => new Date(startIso).getTime() > nowTime);

  return {
    missionScheduleId: String(mission._id),
    date: mission.date,
    morningStart: mission.morningStart,
    morningEnd: mission.morningEnd,
    afternoonStart: mission.afternoonStart,
    afternoonEnd: mission.afternoonEnd,
    durationMinutes,
    availableSlotStarts,
  };
};

const getRescheduleOptionsForAppointment = async ({ appointmentId, residentId, actorRole }) => {
  const appointment = await loadAppointmentOrFail(appointmentId);
  assertOwnership(appointment, residentId, actorRole, "view");
  assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

  const missions = await MissionSchedule.find({ date: { $gte: startOfToday() } })
    .sort({ date: 1 })
    .lean();

  const bookedByMission = await loadBookedForMissions(missions.map((mission) => mission._id));
  const nowTime = Date.now();

  const schedules = missions.map((mission) =>
    buildScheduleOption({
      mission,
      booked: bookedByMission.get(String(mission._id)) ?? [],
      appointment,
      nowTime,
    })
  );

  return {
    appointment: {
      _id: String(appointment._id),
      consultationType: appointment.consultationType,
      status: appointment.status,
      slotStart: appointment.slotStart,
      slotEnd: appointment.slotEnd,
      missionSchedule: appointment.missionSchedule ? String(appointment.missionSchedule) : null,
    },
    schedules,
  };
};

module.exports = { getRescheduleOptionsForAppointment };
