"use strict";

const { hasConflict } = require("../../utils/slotAvailability");
const {
  addDays,
  dayKeyOf,
  endOfPosition,
  positionStarts,
  scheduleOf,
  startOfDay,
  windowsFor,
} = require("../immunization/weeklyCalendar");

// Pure rules for a weekly service whose residents pick their own date and time
// (BP checking). The server clock is pinned to the app timezone (server.js), so
// local midnight is the barangay's day and getHours() is its wall clock.
//
// Capacity: one appointment per slot. No per-slot patient count exists in the
// requirements or the code, so this follows the rule every other service uses
// (a slot is taken once an occupying appointment overlaps it).

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2100;

const DAY_STATUS = Object.freeze({
  OPEN: "open",
  FULL: "full",
  ENDED: "ended",
  CLOSED: "closed",
  PAST: "past",
  BEYOND: "beyond",
});

const pad = (n) => String(n).padStart(2, "0");

const monthKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

/** Local first day of a "YYYY-MM" key, or null when the key is not a month this app can use. */
const monthStartOf = (key) => {
  const match = MONTH_KEY_PATTERN.exec(String(key ?? "").trim());
  if (!match) return null;
  const [year, month] = [Number(match[1]), Number(match[2])];
  if (year < EARLIEST_YEAR || year > LATEST_YEAR || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
};

const daysOfMonth = (monthStart) => {
  const days = [];
  for (let day = monthStart; day.getMonth() === monthStart.getMonth(); day = addDays(day, 1)) days.push(day);
  return days;
};

/** The last day a booking may fall on, or null when the service sets no booking horizon. */
const lastBookableDay = (categoryKey, now) => {
  const { horizonWeeks } = scheduleOf(categoryKey);
  return horizonWeeks ? addDays(startOfDay(now), horizonWeeks * 7 - 1) : null;
};

/** Why a day takes no booking at all, before bookings are counted; null when it still has times ahead. */
const dayClosure = (categoryKey, dayStart, now) => {
  if (dayStart < startOfDay(now)) return DAY_STATUS.PAST;
  if (!scheduleOf(categoryKey).weekdays.includes(dayStart.getDay())) return DAY_STATUS.CLOSED;
  const last = lastBookableDay(categoryKey, now);
  if (last && dayStart > last) return DAY_STATUS.BEYOND;
  if (!positionStarts(categoryKey, dayStart).some((start) => start > now)) return DAY_STATUS.ENDED;
  return null;
};

const isTaken = ({ categoryKey, start, booked, excludeAppointmentId }) =>
  hasConflict(booked, start, endOfPosition(categoryKey, start), excludeAppointmentId);

/** Starts still ahead of `now` that no occupying appointment overlaps, earliest first. */
const openStartsOn = ({ categoryKey, dayStart, booked, now, excludeAppointmentId = null }) =>
  dayClosure(categoryKey, dayStart, now)
    ? []
    : positionStarts(categoryKey, dayStart).filter(
        (start) => start > now && !isTaken({ categoryKey, start, booked, excludeAppointmentId })
      );

const clockOf = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** `time` is the wall clock in the app timezone, so a phone set to another zone still shows 8:00 AM. */
const toSlot = (categoryKey, start) => ({
  start: start.toISOString(),
  end: endOfPosition(categoryKey, start).toISOString(),
  time: clockOf(start),
  period: start.getHours() < 12 ? "morning" : "afternoon",
});

const describeDay = ({ categoryKey, dayStart, booked, now, excludeAppointmentId = null }) => {
  const closure = dayClosure(categoryKey, dayStart, now);
  const open = openStartsOn({ categoryKey, dayStart, booked, now, excludeAppointmentId });
  return {
    dateKey: dayKeyOf(dayStart),
    status: closure ?? (open.length ? DAY_STATUS.OPEN : DAY_STATUS.FULL),
    openSlots: open.length,
    totalSlots: closure === DAY_STATUS.CLOSED ? 0 : positionStarts(categoryKey, dayStart).length,
    open,
  };
};

/** What the app needs to explain the schedule; every value comes from the category config. */
const scheduleSummary = (categoryKey, now) => {
  const { weekdays, intervalMinutes, horizonWeeks } = scheduleOf(categoryKey);
  const last = lastBookableDay(categoryKey, now);
  return {
    timeZone: process.env.TZ || "Asia/Manila",
    intervalMinutes,
    today: dayKeyOf(startOfDay(now)),
    weekdays: weekdays.map((weekday) => ({ weekday, windows: windowsFor(categoryKey, weekday) })),
    bookingHorizonWeeks: horizonWeeks,
    lastBookableDate: last ? dayKeyOf(last) : null,
  };
};

module.exports = {
  DAY_STATUS,
  monthKeyOf,
  monthStartOf,
  daysOfMonth,
  dayClosure,
  isTaken,
  openStartsOn,
  toSlot,
  describeDay,
  scheduleSummary,
};
