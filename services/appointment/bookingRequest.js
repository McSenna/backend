"use strict";

const { getResidentBookableCategories } = require("../../config/consultationCategories");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const parseServiceKey = (consultationType) => {
  if (!consultationType) {
    throw badRequest("Please select a service type.", ERROR_CODES.MISSING_FIELDS);
  }
  const key = String(consultationType).trim();
  if (key === 'immunization') throw badRequest('Immunization appointments are assigned automatically from the baby checklist. Contact the health center to review a date.', ERROR_CODES.VALIDATION_ERROR);
  if (!getResidentBookableCategories().some((category) => category.key === key)) {
    throw badRequest("The selected service is not available.", ERROR_CODES.VALIDATION_ERROR);
  }
  return key;
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

module.exports = { parseServiceKey, parseRequestKey };
