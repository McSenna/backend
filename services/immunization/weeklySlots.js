"use strict";

const Appointment = require("../../models/Appointment");
const { hasConflict } = require("../../utils/slotAvailability");
const { SLOT_OCCUPYING_STATUSES } = require("../queueScope");
const { addDays, dayKeyOf, endOfPosition, positionStarts, upcomingDays } = require("./weeklyCalendar");

/**
 * Visits holding a position that day. Older visits booked through a mission
 * still count: they keep their time, so new bookings work around them.
 */
const loadBookedOnDay = (categoryKey, dayStart, session = null) =>
  Appointment.find({
    consultationType: categoryKey,
    status: { $in: SLOT_OCCUPYING_STATUSES },
    slotStart: { $gte: dayStart, $lt: addDays(dayStart, 1) },
  })
    .select("_id slotStart slotEnd")
    .session(session)
    .lean();

/** Free positions still ahead of `now`, earliest first. The first one is what the next booking gets. */
const openStarts = ({ categoryKey, dayStart, booked, now = new Date(), excludeAppointmentId = null }) =>
  positionStarts(categoryKey, dayStart).filter(
    (start) =>
      start > now &&
      !hasConflict(booked, start, endOfPosition(categoryKey, start), excludeAppointmentId)
  );

const groupByDay = (rows) => {
  const byDay = new Map();
  for (const row of rows) {
    const key = dayKeyOf(new Date(row.slotStart));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }
  return byDay;
};

/**
 * The bookable days with what a resident needs to decide: the time the next
 * booking would get right now (an estimate; the server assigns at booking) and
 * how many positions are left.
 */
const listWeeklyDays = async (categoryKey, { excludeAppointmentId = null, now = new Date() } = {}) => {
  const days = upcomingDays(categoryKey, now);
  if (!days.length) return [];

  const rows = await Appointment.find({
    consultationType: categoryKey,
    status: { $in: SLOT_OCCUPYING_STATUSES },
    slotStart: { $gte: days[0], $lt: addDays(days[days.length - 1], 1) },
  })
    .select("_id slotStart slotEnd")
    .lean();
  const byDay = groupByDay(rows);
  const exclude = excludeAppointmentId ? String(excludeAppointmentId) : null;

  return days.map((dayStart) => {
    const dateKey = dayKeyOf(dayStart);
    const booked = byDay.get(dateKey) ?? [];
    const open = openStarts({ categoryKey, dayStart, booked, now, excludeAppointmentId: exclude });
    return {
      dateKey,
      date: dayStart,
      nextStart: open[0]?.toISOString() ?? null,
      openPositions: open.length,
      totalPositions: positionStarts(categoryKey, dayStart).length,
    };
  });
};

module.exports = { loadBookedOnDay, openStarts, listWeeklyDays };
