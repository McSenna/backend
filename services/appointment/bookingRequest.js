"use strict";

const { getResidentBookableCategories } = require("../../config/consultationCategories");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const trimTo = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const parseServiceKey = (consultationType) => {
  if (!consultationType) {
    throw badRequest("Please select a service type.", ERROR_CODES.MISSING_FIELDS);
  }
  const key = String(consultationType).trim();
  if (!getResidentBookableCategories().some((category) => category.key === key)) {
    throw badRequest("The selected service is not available.", ERROR_CODES.VALIDATION_ERROR);
  }
  return key;
};

const parseFutureStart = (slotStart, now) => {
  const date = new Date(slotStart);
  if (Number.isNaN(date.getTime())) {
    throw badRequest("The selected time is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (date.getTime() <= now.getTime()) {
    throw badRequest("That time has already passed. Please pick a later time.", ERROR_CODES.VALIDATION_ERROR);
  }
  return date;
};

// Optional so an older app build can still book; without it a retry is only
// caught by the one-visit-per-day rules, not matched to the first try.
const parseRequestKey = (requestKey) => {
  if (requestKey == null || requestKey === "") return null;
  if (typeof requestKey !== "string" || !REQUEST_KEY_PATTERN.test(requestKey)) {
    throw badRequest("The booking request could not be read. Please try again.", ERROR_CODES.VALIDATION_ERROR);
  }
  return requestKey;
};

/** A mission service booking: what and when the resident chose. The user never comes from here. */
const parseMissionRequest = (categoryKey, payload = {}, now = new Date()) => {
  const description = trimTo(payload.description, 4000);
  if (!description) {
    throw badRequest("Please describe your reason for visit or symptoms.", ERROR_CODES.MISSING_FIELDS);
  }

  if (!payload.missionScheduleId || !payload.slotStart) {
    throw badRequest("Please choose a date and time for your appointment.", ERROR_CODES.MISSING_FIELDS);
  }

  return {
    categoryKey,
    description,
    additionalNotes: trimTo(payload.additionalNotes, 1000),
    preferredProvider: payload.preferredProvider ?? null,
    isUrgent: Boolean(payload.isUrgent),
    missionId: assertValidObjectId(payload.missionScheduleId, "mission schedule"),
    slotStartDate: parseFutureStart(payload.slotStart, now),
  };
};

module.exports = { parseServiceKey, parseRequestKey, parseMissionRequest };
