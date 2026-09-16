"use strict";

const mongoose = require("mongoose");
const { badRequest } = require("./AppError");
const { ERROR_CODES } = require("./errorCodes");

function assertValidObjectId(id, label = "record") {
  if (!mongoose.isValidObjectId(id)) {
    throw badRequest(
      `Invalid ${label} identifier.`,
      ERROR_CODES.INVALID_ID
    );
  }
  return String(id);
}

const isValidObjectId = (id) => mongoose.isValidObjectId(id);

module.exports = { assertValidObjectId, isValidObjectId };
