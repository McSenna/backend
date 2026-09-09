"use strict";

const mongoose = require("mongoose");
const { badRequest } = require("./AppError");
const { ERROR_CODES } = require("./errorCodes");

/**
 * Guards a route/query parameter before it reaches Mongoose.
 *
 * Without this, an id like "abc" produces a CastError deep inside a query.
 * Rejecting it up front keeps the message specific and avoids a pointless
 * round trip to the database.
 */
function assertValidObjectId(id, label = "record") {
  if (!mongoose.isValidObjectId(id)) {
    throw badRequest(
      `Invalid ${label} identifier.`,
      ERROR_CODES.INVALID_ID
    );
  }
  return String(id);
}

/** Non-throwing variant for optional filters, where an invalid id simply drops the filter. */
const isValidObjectId = (id) => mongoose.isValidObjectId(id);

module.exports = { assertValidObjectId, isValidObjectId };
