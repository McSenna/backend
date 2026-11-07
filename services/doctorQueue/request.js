"use strict";

const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const trimTo = (value, maxLength) => (typeof value === "string" ? value.trim().slice(0, maxLength) : "");

/**
 * A request for a queued doctor service: what the resident needs, never when.
 * Any mission, date or time in the body is ignored on purpose, because the
 * queue assigns the slot; an older app build that still sends one is queued too.
 */
const parseQueuedRequest = (categoryKey, payload = {}) => {
  const description = trimTo(payload.description, 4000);
  if (!description) {
    throw badRequest("Please describe your reason for visit or symptoms.", ERROR_CODES.MISSING_FIELDS);
  }
  return {
    categoryKey,
    description,
    additionalNotes: trimTo(payload.additionalNotes, 1000),
    preferredProvider: payload.preferredProvider ?? null,
    isUrgent: Boolean(payload.isUrgent),
  };
};

module.exports = { parseQueuedRequest };
