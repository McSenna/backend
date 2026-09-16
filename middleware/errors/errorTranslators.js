"use strict";

const { EmailServiceError } = require("../../services/mailer/errors");
const AppError = require("../../utils/AppError");
const { HTTP_STATUS, ERROR_CODES, SAFE_MESSAGES } = require("../../utils/errorCodes");
const { isDatabaseUnavailableError, duplicateFieldLabel } = require("./databaseErrors");

const isProduction = () => process.env.NODE_ENV === "production";

const safe = (statusCode, code) => ({ statusCode, code, message: SAFE_MESSAGES[code] });

// Order matters: the first matching rule wins, exactly as the original
// if-chain did.
const TRANSLATORS = [
  {
    match: (err) => err instanceof AppError,
    translate: (err) => ({
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    }),
  },
  {
    match: (err) => err instanceof EmailServiceError,
    translate: (err) => ({
      statusCode: err.httpStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: err.code === "EMAIL_QUOTA_EXCEEDED" ? ERROR_CODES.EMAIL_SERVICE_LIMIT : err.code,
      message: err.userMessage,
    }),
  },
  {
    match: (err) => err.name === "ValidationError",
    translate: (err) => {
      const errors = Object.values(err.errors || {}).map((entry) => entry.message);
      return {
        statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: errors[0] || "Please review the information you entered.",
        details: errors.length ? { errors } : undefined,
      };
    },
  },
  {
    match: (err) => err.name === "CastError",
    translate: () => safe(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_ID),
  },
  {
    match: (err) => err.code === 11000 || err.code === 11001,
    translate: (err) => {
      const { field, label } = duplicateFieldLabel(err);
      return {
        statusCode: HTTP_STATUS.CONFLICT,
        code: field === "email" ? ERROR_CODES.EMAIL_EXISTS : ERROR_CODES.DUPLICATE_RESOURCE,
        message: label,
      };
    },
  },
  {
    match: (err) => err.name === "VersionError",
    translate: () => ({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.CONFLICT,
      message: "This record was changed by someone else. Please refresh and try again.",
    }),
  },
  {
    match: (err) => err.name === "DocumentNotFoundError",
    translate: () => safe(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND),
  },
  {
    match: (err) => err.name === "TokenExpiredError",
    translate: () => safe(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.TOKEN_EXPIRED),
  },
  {
    match: (err) => err.name === "JsonWebTokenError" || err.name === "NotBeforeError",
    translate: () => safe(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.INVALID_TOKEN),
  },
  {
    match: isDatabaseUnavailableError,
    translate: () => safe(HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.DATABASE_ERROR),
  },
  {
    match: (err) => err.name === "MongoServerError" || err.name === "MongoError",
    translate: () => safe(HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.DATABASE_ERROR),
  },
  {
    match: (err) =>
      err.type === "entity.too.large" || err.status === HTTP_STATUS.PAYLOAD_TOO_LARGE,
    translate: () => safe(HTTP_STATUS.PAYLOAD_TOO_LARGE, ERROR_CODES.PAYLOAD_TOO_LARGE),
  },
  {
    match: (err) => err.type === "entity.parse.failed" || err instanceof SyntaxError,
    translate: () => safe(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.MALFORMED_JSON),
  },
];

const inHttpRange = (value) => Number.isInteger(value) && value >= 400 && value <= 599;

const fallbackStatus = (err) => {
  if (inHttpRange(err.statusCode)) return err.statusCode;
  if (inHttpRange(err.status)) return err.status;
  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
};

const normalizeError = (err) => {
  const rule = TRANSLATORS.find((candidate) => candidate.match(err));
  if (rule) return rule.translate(err);

  return {
    statusCode: fallbackStatus(err),
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    message: isProduction()
      ? SAFE_MESSAGES[ERROR_CODES.INTERNAL_SERVER_ERROR]
      : err.message || SAFE_MESSAGES[ERROR_CODES.INTERNAL_SERVER_ERROR],
    unexpected: true,
  };
};

module.exports = { normalizeError, isProduction };
