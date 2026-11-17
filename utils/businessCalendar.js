"use strict";

// The barangay's calendar. Same source as server.js, but read here with an
// explicit zone so a rule never depends on what the process clock was set to.
const BUSINESS_TIME_ZONE = process.env.APP_TIMEZONE || "Asia/Manila";

const formatters = new Map();
const formatterFor = (timeZone) => {
  if (!formatters.has(timeZone)) {
    // en-CA formats as YYYY-MM-DD. An unknown zone throws here, so a bad
    // APP_TIMEZONE fails closed instead of picking some other calendar.
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    );
  }
  return formatters.get(timeZone);
};

/** "YYYY-MM-DD" of an instant in the given zone, or null when it is not a real date. */
const calendarDayIn = (value, timeZone = BUSINESS_TIME_ZONE) => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatterFor(timeZone).format(date);
};

module.exports = { BUSINESS_TIME_ZONE, calendarDayIn };
