"use strict";
const mongoose = require("mongoose");
const { serviceUnavailable } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

// Queueing HTTP work during a known outage only delays the same refusal and
// retains request bodies in memory. Already-running operations have driver limits.
const databaseReady = (_req, _res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  next(serviceUnavailable(
    "The database is temporarily unavailable. Please try again shortly.",
    ERROR_CODES.DATABASE_ERROR,
  ));
};
module.exports = { databaseReady };
