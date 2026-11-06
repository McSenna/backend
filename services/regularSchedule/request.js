"use strict";

const { getCategory } = require("../../config/consultationCategories");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { serviceDayMessage } = require("../appointment/serviceDayRules");
const { dayKeyOf, dayStartOf, positionStarts, scheduleOf } = require("../immunization/weeklyCalendar");
const { DAY_STATUS, dayClosure } = require("./calendar");

const labelOf = (categoryKey) => getCategory(categoryKey)?.label ?? "This service";

const trimTo = (value, maxLength) => (typeof value === "string" ? value.trim().slice(0, maxLength) : "");

const closureMessage = (categoryKey, closure) => {
  switch (closure) {
    case DAY_STATUS.PAST:
      return "That date has passed. Please choose today or a later date.";
    case DAY_STATUS.CLOSED:
      return serviceDayMessage(categoryKey);
    case DAY_STATUS.BEYOND:
      return `${labelOf(categoryKey)} can be booked up to ${scheduleOf(categoryKey).horizonWeeks} weeks ahead. Please choose an earlier date.`;
    default:
      return `Today's ${labelOf(categoryKey)} times have all passed. Please choose another date.`;
  }
};

/**
 * The chosen date and start, checked against the schedule alone: a real date,
 * not past, on a service day, inside the booking window, and a start on that
 * day's grid (so no 12:00, 16:00, lunch-break or off-interval start) that has
 * not begun. Whether it is still free is checked later, under the day lock.
 */
const parseRegularStart = (categoryKey, { appointmentDate, slotStart } = {}, now = new Date()) => {
  if (!appointmentDate || !slotStart) {
    throw badRequest("Please choose a date and time for your appointment.", ERROR_CODES.MISSING_FIELDS);
  }
  const dayStart = dayStartOf(appointmentDate);
  if (!dayStart) {
    throw badRequest("The appointment date is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
  }
  const start = new Date(slotStart);
  if (Number.isNaN(start.getTime())) {
    throw badRequest("The selected time is not a valid time.", ERROR_CODES.VALIDATION_ERROR);
  }

  const closure = dayClosure(categoryKey, dayStart, now);
  if (closure) throw badRequest(closureMessage(categoryKey, closure), ERROR_CODES.VALIDATION_ERROR);

  if (dayKeyOf(start) !== dayKeyOf(dayStart)) {
    throw badRequest("The selected time is not on the chosen date. Please pick a time from the list.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (!positionStarts(categoryKey, dayStart).some((position) => position.getTime() === start.getTime())) {
    throw badRequest(
      `That time is not one of the ${labelOf(categoryKey)} appointment times. Please pick a time from the list.`,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  if (start <= now) {
    throw badRequest("That time has already passed. Please pick a later time.", ERROR_CODES.VALIDATION_ERROR);
  }
  return { dayStart, slotStartDate: start };
};

/** A resident's booking: the reason, optional notes, and the chosen date and time. Never the user. */
const parseRegularRequest = (categoryKey, payload = {}, now = new Date()) => {
  const description = trimTo(payload.description, 4000);
  if (!description) {
    throw badRequest("Please describe your reason for visit or symptoms.", ERROR_CODES.MISSING_FIELDS);
  }
  return {
    categoryKey,
    description,
    additionalNotes: trimTo(payload.additionalNotes, 1000),
    ...parseRegularStart(categoryKey, payload, now),
  };
};

module.exports = { parseRegularStart, parseRegularRequest };
