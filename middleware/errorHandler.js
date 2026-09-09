"use strict";

const { EmailServiceError } = require("../services/mailer/errors");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { HTTP_STATUS, ERROR_CODES, SAFE_MESSAGES } = require("../utils/errorCodes");
const asyncHandler = require("../utils/asyncHandler");

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Backwards-compatible alias.
 *
 * `ApiError` was the original custom error in this project and is kept so that
 * any remaining `new ApiError(status, message, code)` call site keeps working.
 * New code should use `AppError` (message-first), which is the canonical class.
 */
class ApiError extends AppError {
  constructor(statusCode, message, code = ERROR_CODES.INTERNAL_SERVER_ERROR) {
    super(message, statusCode, code);
    this.name = "ApiError";
  }
}

/**
 * Turns any thrown value into the single response shape the API guarantees:
 *   { success: false, message, code }
 *
 * Every branch must produce a message that is safe to show a patient or a
 * health worker — never a driver string, a stack trace, or a connection URI.
 */
function normalizeError(err) {
  // 1. Operational application errors — message is authored by us and trusted.
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  // 2. Classified email/SMTP failures.
  if (err instanceof EmailServiceError) {
    return {
      statusCode: err.httpStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
      code:
        err.code === "EMAIL_QUOTA_EXCEEDED"
          ? ERROR_CODES.EMAIL_SERVICE_LIMIT
          : err.code,
      message: err.userMessage,
    };
  }

  // 3. Mongoose schema validation — surface the field messages, which are
  //    authored in the models and safe by construction.
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    return {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: errors[0] || "Please review the information you entered.",
      details: errors.length ? { errors } : undefined,
    };
  }

  // 4. Invalid ObjectId / uncastable value reaching a query.
  //    The raw form is `Cast to ObjectId failed for value "abc"` — never shown.
  if (err.name === "CastError") {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.INVALID_ID,
      message: SAFE_MESSAGES[ERROR_CODES.INVALID_ID],
    };
  }

  // 5. Duplicate key (E11000). Name the offending field when the driver tells us.
  if (err.code === 11000 || err.code === 11001) {
    const field =
      Object.keys(err.keyPattern || err.keyValue || {})[0] || "value";
    const label = DUPLICATE_FIELD_LABELS[field] || `${field} already exists.`;
    return {
      statusCode: HTTP_STATUS.CONFLICT,
      code:
        field === "email"
          ? ERROR_CODES.EMAIL_EXISTS
          : ERROR_CODES.DUPLICATE_RESOURCE,
      message: label,
    };
  }

  // 6. Optimistic concurrency / stale document.
  if (err.name === "VersionError") {
    return {
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.CONFLICT,
      message:
        "This record was changed by someone else. Please refresh and try again.",
    };
  }

  if (err.name === "DocumentNotFoundError") {
    return {
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.NOT_FOUND,
      message: SAFE_MESSAGES[ERROR_CODES.NOT_FOUND],
    };
  }

  // 7. JWT failures that were thrown rather than handled in auth middleware.
  if (err.name === "TokenExpiredError") {
    return {
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.TOKEN_EXPIRED,
      message: SAFE_MESSAGES[ERROR_CODES.TOKEN_EXPIRED],
    };
  }

  if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
    return {
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.INVALID_TOKEN,
      message: SAFE_MESSAGES[ERROR_CODES.INVALID_TOKEN],
    };
  }

  // 8. Database availability. These carry cluster hosts and sometimes
  //    credentials in their message, so nothing from them may reach the client.
  if (isDatabaseUnavailableError(err)) {
    return {
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.DATABASE_ERROR,
      message: SAFE_MESSAGES[ERROR_CODES.DATABASE_ERROR],
    };
  }

  // 9. Any other driver-level failure.
  if (err.name === "MongoServerError" || err.name === "MongoError") {
    return {
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.DATABASE_ERROR,
      message: SAFE_MESSAGES[ERROR_CODES.DATABASE_ERROR],
    };
  }

  // 10. Body parser failures raised by express.json / urlencoded.
  if (err.type === "entity.too.large" || err.status === HTTP_STATUS.PAYLOAD_TOO_LARGE) {
    return {
      statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE,
      code: ERROR_CODES.PAYLOAD_TOO_LARGE,
      message: SAFE_MESSAGES[ERROR_CODES.PAYLOAD_TOO_LARGE],
    };
  }

  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.MALFORMED_JSON,
      message: SAFE_MESSAGES[ERROR_CODES.MALFORMED_JSON],
    };
  }

  // 11. Unexpected fault. Only a numeric status is trusted from an unknown
  //     error — `err.code` on a driver error is a string like "ETIMEDOUT" and
  //     must not become the client-facing error code.
  const statusCode =
    Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode <= 599
      ? err.statusCode
      : Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
        ? err.status
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

  return {
    statusCode,
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    message: isProduction()
      ? SAFE_MESSAGES[ERROR_CODES.INTERNAL_SERVER_ERROR]
      : err.message || SAFE_MESSAGES[ERROR_CODES.INTERNAL_SERVER_ERROR],
    unexpected: true,
  };
}

const DUPLICATE_FIELD_LABELS = Object.freeze({
  email: "This email address is already registered.",
  contactNumber: "This contact number is already registered.",
  username: "This username is already taken.",
  date: "A record already exists for this date.",
});

function isDatabaseUnavailableError(err) {
  const name = String(err?.name || "");
  if (
    name === "MongoNetworkError" ||
    name === "MongoServerSelectionError" ||
    name === "MongooseServerSelectionError" ||
    name === "MongoNetworkTimeoutError" ||
    name === "MongoTimeoutError"
  ) {
    return true;
  }

  // Mongoose buffers operations while disconnected and rejects with this.
  const message = String(err?.message || "");
  return (
    message.includes("buffering timed out") ||
    message.includes("Client must be connected before running operations")
  );
}

/**
 * Centralized Express error middleware. Must be registered after all routes.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
const globalErrorHandler = (err, req, res, next) => {
  const { statusCode, code, message, details, unexpected } = normalizeError(err);

  logger.requestError(err, req, {
    statusCode,
    code,
    isOperational: Boolean(err?.isOperational) && !unexpected,
  });

  // A streamed or already-sent response cannot be replaced; hand it to Express
  // so the socket is closed instead of throwing ERR_HTTP_HEADERS_SENT.
  if (res.headersSent) {
    return next(err);
  }

  const body = {
    success: false,
    message,
    code,
  };

  if (details && typeof details === "object") {
    Object.assign(body, details);
  }

  // Developer detail is available outside production only, and never for the
  // errors whose raw text can carry infrastructure information.
  if (!isProduction() && unexpected) {
    body.debug = {
      name: err?.name,
      stack: err?.stack,
    };
  }

  return res.status(statusCode).json(body);
};

/**
 * Terminal 404 for unmatched API routes, so an unknown path returns JSON
 * rather than Express's default HTML error page.
 */
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
  ApiError,
  AppError,
  globalErrorHandler,
  notFoundHandler,
  asyncHandler,
  normalizeError,
};
