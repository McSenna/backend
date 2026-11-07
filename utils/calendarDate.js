"use strict";

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseCalendarDate = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!CALENDAR_DATE.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text) ? date : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDayRange = (date) => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
};

module.exports = { parseCalendarDate, utcDayRange };
