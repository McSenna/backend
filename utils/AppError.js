"use strict";

const { HTTP_STATUS, ERROR_CODES } = require("./errorCodes");

class AppError extends Error {
  constructor(
    message,
    statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code = ERROR_CODES.INTERNAL_SERVER_ERROR,
    details = undefined
  ) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    if (details !== undefined) {
      this.details = details;
    }

    Error.captureStackTrace(this, this.constructor);
  }
}

const badRequest = (message, code = ERROR_CODES.VALIDATION_ERROR, details) =>
  new AppError(message, HTTP_STATUS.BAD_REQUEST, code, details);

const validationFailed = (message, errors) =>
  new AppError(
    message,
    HTTP_STATUS.UNPROCESSABLE_ENTITY,
    ERROR_CODES.VALIDATION_ERROR,
    Array.isArray(errors) && errors.length ? { errors } : undefined
  );

const unauthorized = (
  message = "Your session has expired. Please log in again.",
  code = ERROR_CODES.AUTHENTICATION_REQUIRED
) => new AppError(message, HTTP_STATUS.UNAUTHORIZED, code);

const forbidden = (
  message = "You do not have permission to perform this action.",
  code = ERROR_CODES.FORBIDDEN
) => new AppError(message, HTTP_STATUS.FORBIDDEN, code);

const notFound = (message, code = ERROR_CODES.NOT_FOUND) =>
  new AppError(message, HTTP_STATUS.NOT_FOUND, code);

const conflict = (message, code = ERROR_CODES.CONFLICT) =>
  new AppError(message, HTTP_STATUS.CONFLICT, code);

const tooManyRequests = (
  message = "Too many requests. Please try again shortly.",
  code = ERROR_CODES.RATE_LIMIT_EXCEEDED
) => new AppError(message, HTTP_STATUS.TOO_MANY_REQUESTS, code);

const serviceUnavailable = (
  message = "The service is temporarily unavailable. Please try again later.",
  code = ERROR_CODES.SERVICE_UNAVAILABLE
) => new AppError(message, HTTP_STATUS.SERVICE_UNAVAILABLE, code);

module.exports = AppError;
module.exports.AppError = AppError;
module.exports.badRequest = badRequest;
module.exports.validationFailed = validationFailed;
module.exports.unauthorized = unauthorized;
module.exports.forbidden = forbidden;
module.exports.notFound = notFound;
module.exports.conflict = conflict;
module.exports.tooManyRequests = tooManyRequests;
module.exports.serviceUnavailable = serviceUnavailable;
