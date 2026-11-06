"use strict";

const { getCategory } = require("../../config/consultationCategories");
const { parseHHMM } = require("../../utils/slotAvailability");

// The server clock is pinned to Asia/Manila (server.js), so local midnight is
// the barangay's calendar day and getDay() is its weekday.
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE_MS = 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");

/** "2026-10-07" for the local day of `date`. */
const dayKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Local midnight of a "YYYY-MM-DD" key, or null when the key is not a real date. */
const dayStartOf = (key) => {
  const match = DAY_KEY_PATTERN.exec(String(key ?? "").trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(year, month, day);
  const sameDay = date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
  return sameDay ? date : null;
};

const addDays = (dayStart, days) =>
  new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + days);

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Staff placement still needs a finite list of days for a service that sets no
// booking horizon (BP checking). This bounds that search; it is not a booking limit.
const OPEN_ENDED_SCAN_WEEKS = 8;

const scheduleOf = (categoryKey) => {
  const category = getCategory(categoryKey);
  return {
    weekdays: category.serviceWeekdays,
    windows: category.serviceWindows,
    windowsByWeekday: category.serviceWindowsByWeekday ?? {},
    intervalMinutes: category.durationMinutes,
    horizonWeeks: category.bookingHorizonWeeks ?? null,
  };
};

/** The opening windows on one weekday: its own list (a half day), or the service's usual hours. */
const windowsFor = (categoryKey, weekday) => {
  const { windows, windowsByWeekday } = scheduleOf(categoryKey);
  return windowsByWeekday[weekday] ?? windows;
};

/** Every position of the day, `intervalMinutes` apart from each window's start: 08:00, 08:10, ... */
const positionStarts = (categoryKey, dayStart) => {
  const { intervalMinutes } = scheduleOf(categoryKey);
  const starts = [];
  for (const window of windowsFor(categoryKey, dayStart.getDay())) {
    const end = parseHHMM(window.end);
    for (let minute = parseHHMM(window.start); minute + intervalMinutes <= end; minute += intervalMinutes) {
      starts.push(new Date(dayStart.getTime() + minute * MINUTE_MS));
    }
  }
  return starts;
};

/**
 * Service days from today through the booking horizon (8 weeks covers the next
 * 8 Thursdays). A day whose last position has already started is left out.
 */
const upcomingDays = (categoryKey, now = new Date()) => {
  const { weekdays, horizonWeeks } = scheduleOf(categoryKey);
  const today = startOfDay(now);
  const days = [];
  for (let offset = 0; offset < (horizonWeeks ?? OPEN_ENDED_SCAN_WEEKS) * 7; offset += 1) {
    const day = addDays(today, offset);
    if (!weekdays.includes(day.getDay())) continue;
    if (positionStarts(categoryKey, day).some((start) => start > now)) days.push(day);
  }
  return days;
};

const endOfPosition = (categoryKey, start) =>
  new Date(start.getTime() + scheduleOf(categoryKey).intervalMinutes * MINUTE_MS);

/**
 * The value of the unique `immunizationSlotKey` index that backs the day lock.
 * Immunization keeps its bare start time, as stored since 2026-10-01; another
 * weekly service is prefixed so its 08:00 never collides with a Thursday shot.
 */
const weeklySlotKey = (categoryKey, start) =>
  categoryKey === "immunization" ? start.toISOString() : `${categoryKey}:${start.toISOString()}`;

module.exports = {
  weeklySlotKey,
  dayKeyOf,
  dayStartOf,
  addDays,
  startOfDay,
  scheduleOf,
  windowsFor,
  positionStarts,
  upcomingDays,
  endOfPosition,
};
