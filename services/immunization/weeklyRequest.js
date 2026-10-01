"use strict";

const { getCategory } = require("../../config/consultationCategories");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isServiceDay, serviceDayMessage } = require("../appointment/serviceDayRules");
const { dayStartOf, startOfDay, upcomingDays } = require("./weeklyCalendar");

// Letters (any script, with accents), then letters, spaces, periods, apostrophes, hyphens.
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;
const EARLIEST_BIRTH_YEAR = 1900;

const labelOf = (categoryKey) => getCategory(categoryKey)?.label ?? "This service";

/** The requested service day: a real date, on the service's weekday, inside the booking window. */
const parseBookableDay = (categoryKey, raw, now = new Date()) => {
  if (!raw) {
    throw badRequest("Please choose a Wednesday for the appointment.", ERROR_CODES.MISSING_FIELDS);
  }
  const dayStart = dayStartOf(raw);
  if (!dayStart) {
    throw badRequest("The appointment date is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (!isServiceDay(categoryKey, dayStart)) {
    throw badRequest(serviceDayMessage(categoryKey), ERROR_CODES.VALIDATION_ERROR);
  }
  if (upcomingDays(categoryKey, now).some((day) => day.getTime() === dayStart.getTime())) return dayStart;

  const { bookingHorizonWeeks } = getCategory(categoryKey);
  throw badRequest(
    dayStart.getTime() <= startOfDay(now).getTime()
      ? `${labelOf(categoryKey)} times for that day have passed. Please choose a later Wednesday.`
      : `${labelOf(categoryKey)} can be booked up to ${bookingHorizonWeeks} weeks ahead. Please choose an earlier Wednesday.`,
    ERROR_CODES.VALIDATION_ERROR
  );
};

const parseChildName = (raw) => {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) throw badRequest("Please enter the child's name.", ERROR_CODES.MISSING_FIELDS);
  if (name.length < 2 || name.length > 120 || !NAME_PATTERN.test(name)) {
    throw badRequest(
      "Please enter the child's full name using letters only, like Juan Dela Cruz.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return name;
};

const parseChildBirthDate = (raw, now = new Date()) => {
  if (!raw) throw badRequest("Please enter the child's date of birth.", ERROR_CODES.MISSING_FIELDS);
  const born = dayStartOf(raw);
  if (!born || born.getFullYear() < EARLIEST_BIRTH_YEAR) {
    throw badRequest("The child's date of birth is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (born > startOfDay(now)) {
    throw badRequest("The child's date of birth can't be in the future.", ERROR_CODES.VALIDATION_ERROR);
  }
  return born;
};

/**
 * What a resident may send for a weekly service. Anything else in the body
 * (a time, a mission, a reason) is ignored: the server assigns the time.
 */
const parseWeeklyRequest = (categoryKey, payload = {}, now = new Date()) => ({
  categoryKey,
  childName: parseChildName(payload.childName),
  childDateOfBirth: parseChildBirthDate(payload.childDateOfBirth, now),
  dayStart: parseBookableDay(categoryKey, payload.appointmentDate, now),
});

module.exports = { parseBookableDay, parseWeeklyRequest };
