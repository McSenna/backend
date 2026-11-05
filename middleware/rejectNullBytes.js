"use strict";

const { badRequest } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

const MAX_DEPTH = 8;

const hasNullByte = (value, depth = 0) => {
  if (typeof value === "string") return value.includes("\u0000");
  if (!value || typeof value !== "object" || depth >= MAX_DEPTH) return false;
  return Object.values(value).some((entry) => hasNullByte(entry, depth + 1));
};

// MongoDB refuses null bytes in search patterns, which surfaced as a 500. No field
// in this app can hold one, so the request is refused before it reaches a query.
const rejectNullBytes = (req, _res, next) => {
  if (hasNullByte(req.query) || hasNullByte(req.body)) {
    return next(badRequest("This request contains characters that can't be read. Remove them and try again.", ERROR_CODES.VALIDATION_ERROR));
  }
  return next();
};

module.exports = { rejectNullBytes };
