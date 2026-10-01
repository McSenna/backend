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

const scheduleOf = (categoryKey) => {
  const category = getCategory(categoryKey);
  return {
    weekdays: category.serviceWeekdays,
    windows: category.serviceWindows,
    intervalMinutes: category.durationMinutes,
    horizonWeeks: category.bookingHorizonWeeks,
  };
};

/** Every position of the day, `intervalMinutes` apart from each window's start: 08:00, 08:10, ... */
const positionStarts = (categoryKey, dayStart) => {
  const { windows, intervalMinutes } = scheduleOf(categoryKey);
  const starts = [];
  for (const window of windows) {
    const end = parseHHMM(window.end);
    for (let minute = parseHHMM(window.start); minute + intervalMinutes <= end; minute += intervalMinutes) {
      starts.push(new Date(dayStart.getTime() + minute * MINUTE_MS));
    }
  }
  return starts;
};

/**
 * Service days from today through the booking horizon (8 weeks covers the next
 * 8 Wednesdays). A day whose last position has already started is left out.
 */
const upcomingDays = (categoryKey, now = new Date()) => {
  const { weekdays, horizonWeeks } = scheduleOf(categoryKey);
  const today = startOfDay(now);
  const days = [];
  for (let offset = 0; offset < horizonWeeks * 7; offset += 1) {
    const day = addDays(today, offset);
    if (!weekdays.includes(day.getDay())) continue;
    if (positionStarts(categoryKey, day).some((start) => start > now)) days.push(day);
  }
  return days;
};

const endOfPosition = (categoryKey, start) =>
  new Date(start.getTime() + scheduleOf(categoryKey).intervalMinutes * MINUTE_MS);

module.exports = {
  dayKeyOf,
  dayStartOf,
  addDays,
  startOfDay,
  scheduleOf,
  positionStarts,
  upcomingDays,
  endOfPosition,
};
