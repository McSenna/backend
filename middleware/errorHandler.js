"use strict";

const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { HTTP_STATUS, ERROR_CODES, SAFE_MESSAGES } = require("../utils/errorCodes");
const asyncHandler = require("../utils/asyncHandler");
const { normalizeError, isProduction } = require("./errors/errorTranslators");

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
const globalErrorHandler = (err, req, res, next) => {
  const { statusCode, code, message, details, unexpected } = normalizeError(err);

  logger.requestError(err, req, {
    statusCode,
    code,
    isOperational: Boolean(err?.isOperational) && !unexpected,
  });

  if (res.headersSent) {
    return next(err);
  }

  const body = { success: false, message, code };

  if (details && typeof details === "object") {
    Object.assign(body, details);
  }

  if (!isProduction() && unexpected) {
    body.debug = { name: err?.name, stack: err?.stack };
  }

  return res.status(statusCode).json(body);
};

const notFoundHandler = (req, _res, next) => {
  next(
    new AppError(
      SAFE_MESSAGES[ERROR_CODES.ROUTE_NOT_FOUND],
      HTTP_STATUS.NOT_FOUND,
      ERROR_CODES.ROUTE_NOT_FOUND
    )
  );
};

module.exports = {
  AppError,
  globalErrorHandler,
  notFoundHandler,
  asyncHandler,
  normalizeError,
};
