"use strict";

const { getCategory } = require("../../config/consultationCategories");
const { startOfDay } = require("../../utils/dateWindow");
const { badRequest, conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

// Weekdays are read with the server clock, which server.js pins to the
// barangay's timezone. Mission dates are stored as local midnight on that same
// clock, so a Wednesday mission never reads as Tuesday or Thursday here.

const WEEKDAY_NAMES = Object.freeze([
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]);

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

const serviceWeekdaysOf = (categoryKey) => {
  const weekdays = getCategory(categoryKey)?.serviceWeekdays;
  return Array.isArray(weekdays) && weekdays.length ? weekdays : null;
};

const labelOf = (categoryKey) => getCategory(categoryKey)?.label ?? "This service";

const weekdaysLabel = (weekdays) => listFormat.format(weekdays.map((day) => `${WEEKDAY_NAMES[day]}s`));

const isServiceDay = (categoryKey, date) => {
  const weekdays = serviceWeekdaysOf(categoryKey);
  if (!weekdays) return true;
  const day = new Date(date);
  return !Number.isNaN(day.getTime()) && weekdays.includes(day.getDay());
};

const serviceDayMessage = (categoryKey) =>
  `${labelOf(categoryKey)} appointments are only available on ${weekdaysLabel(serviceWeekdaysOf(categoryKey))}.`;

/** Guards every path that puts an appointment on a date: assign, reassign, reschedule, slot pickers. */
const assertServiceDay = (categoryKey, date) => {
  if (isServiceDay(categoryKey, date)) return;
  throw badRequest(serviceDayMessage(categoryKey), ERROR_CODES.VALIDATION_ERROR);
};

/** A mission may only offer a fixed-day service on one of that service's days. */
const assertCategoriesFitDay = (categories, day) => {
  const misplaced = categories.find(({ categoryKey }) => !isServiceDay(categoryKey, day));
  if (!misplaced) return;

  const label = labelOf(misplaced.categoryKey);
  throw badRequest(
    `${label} only runs on ${weekdaysLabel(serviceWeekdaysOf(misplaced.categoryKey))}. Choose one of those days or turn off ${label} for this mission.`,
    ERROR_CODES.VALIDATION_ERROR
  );
};

const formatDay = (date) =>
  date.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });

/**
 * A fixed-day service is delivered on its clinic day, so it cannot be signed
 * off before that calendar day. Later days stay open, as for every other
 * service, so a record can still be filed after the visit. Uses the server
 * clock on purpose: a device with a wrong date cannot unlock it early.
 */
const assertCompletionDayReached = (appointment, now = new Date()) => {
  if (!serviceWeekdaysOf(appointment.consultationType)) return;

  const scheduledDay = appointment.slotStart ? startOfDay(appointment.slotStart) : null;
  if (scheduledDay && startOfDay(now).getTime() >= scheduledDay.getTime()) return;

  const label = labelOf(appointment.consultationType);
  throw conflict(
    scheduledDay
      ? `This ${label.toLowerCase()} appointment can be completed on ${formatDay(scheduledDay)}, its scheduled day.`
      : `This ${label.toLowerCase()} appointment has no scheduled date yet, so it cannot be completed.`,
    ERROR_CODES.INVALID_STATUS_TRANSITION
  );
};

module.exports = {
  isServiceDay,
  serviceDayMessage,
  assertServiceDay,
  assertCategoriesFitDay,
  assertCompletionDayReached,
};
