"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_LABELS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

const MONTH_LABELS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

function startOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayBounds(now = new Date()) {
  const start = startOfDay(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

function buildDayWindow(days, now = new Date()) {
  const startOfToday = startOfDay(now);
  const slots = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(startOfToday.getTime() - i * DAY_MS);
    slots.push({
      key: dayKey(date),
      label: WEEKDAY_LABELS[date.getDay()],
      date: date.toISOString(),
      start: date,
    });
  }
  return slots;
}

function buildMonthWindow(months, now = new Date()) {
  const slots = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    slots.push({
      key: monthKey(date),
      label: MONTH_LABELS[date.getMonth()],
      date: date.toISOString(),
      start: date,
    });
  }
  return slots;
}

function buildDenseSeries(buckets, window) {
  const counts = new Map(buckets.map((bucket) => [bucket.key, bucket.count]));
  return window.map((slot) => ({
    key: slot.key,
    label: slot.label,
    count: counts.get(slot.key) || 0,
  }));
}

module.exports = {
  DAY_MS,
  WEEKDAY_LABELS,
  MONTH_LABELS,
  startOfDay,
  todayBounds,
  dayKey,
  monthKey,
  buildDayWindow,
  buildMonthWindow,
  buildDenseSeries,
};
