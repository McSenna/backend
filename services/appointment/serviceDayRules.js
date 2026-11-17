"use strict";

const { getCategory, residentPicksTime, isQueuedService } = require("../../config/consultationCategories");
const AppError = require("../../utils/AppError");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { BUSINESS_TIME_ZONE, calendarDayIn } = require("../../utils/businessCalendar");

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

/** "Thursday" for a one-day service, "day" for a service open on several days. */
const serviceDayWord = (categoryKey) => {
  const weekdays = serviceWeekdaysOf(categoryKey);
  return weekdays?.length === 1 ? WEEKDAY_NAMES[weekdays[0]] : "day";
};

/** "every Thursday", or "Mondays, Tuesdays, ... and Saturdays" for a multi-day service. */
const serviceDaysPhrase = (categoryKey) => {
  const weekdays = serviceWeekdaysOf(categoryKey);
  if (!weekdays) return "every day";
  return weekdays.length === 1 ? `every ${WEEKDAY_NAMES[weekdays[0]]}` : `on ${weekdaysLabel(weekdays)}`;
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

// Noon UTC of a calendar key reads as that same day in every zone from UTC-11 to UTC+11.
const formatDayKey = (dayKey) =>
  new Date(`${dayKey}T12:00:00.000Z`).toLocaleDateString("en-PH", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/**
 * Services whose visit happens on its scheduled day: the doctor's mission
 * services and immunization. BP checking and prenatal run on resident-picked
 * times and were never locked, so a resident who comes in early can still be
 * seen and signed off.
 */
const isDateLockedService = (categoryKey) =>
  isQueuedService(categoryKey) || Boolean(serviceWeekdaysOf(categoryKey) && !residentPicksTime(categoryKey));

/**
 * Completing a visit, and the medical record filed with it, opens at the start
 * of the scheduled calendar day in the barangay's time zone; the slot time does
 * not matter and later days stay open. `now` is the server clock on purpose, so
 * a device with a wrong date or a forged request cannot unlock it early. A
 * missing or unreadable date is refused rather than allowed.
 */
const assertCompletionDayReached = (appointment, now = new Date(), timeZone = BUSINESS_TIME_ZONE) => {
  if (!isDateLockedService(appointment.consultationType)) return;

  const scheduledDate = calendarDayIn(appointment.slotStart, timeZone);
  const today = calendarDayIn(now, timeZone);
  if (scheduledDate && today && today >= scheduledDate) return;

  throw new AppError(
    scheduledDate
      ? `You can complete this appointment or add medical details starting on ${formatDayKey(scheduledDate)}.`
      : "This appointment has no scheduled date yet, so it cannot be completed. Place it on a schedule first.",
    HTTP_STATUS.CONFLICT,
    ERROR_CODES.APPOINTMENT_DATE_NOT_REACHED,
    { scheduledDate, timeZone }
  );
};

module.exports = {
  isServiceDay,
  serviceDayWord,
  serviceDaysPhrase,
  serviceDayMessage,
  assertServiceDay,
  assertCategoriesFitDay,
  assertCompletionDayReached,
};
