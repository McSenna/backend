"use strict";

/**
 * Central catalogue of machine-readable error codes and HTTP statuses.
 *
 * Codes are contract: the frontend branches on them, so they must stay stable.
 * Messages are human-readable and are supplied at the throw site (or by the
 * global error handler for normalized infrastructure errors).
 */

const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

const ERROR_CODES = Object.freeze({
  // Validation / input
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MISSING_FIELDS: "MISSING_FIELDS",
  INVALID_ID: "INVALID_ID",
  INVALID_PHOTO: "INVALID_PHOTO",
  INVALID_FORMAT: "INVALID_FORMAT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  MALFORMED_JSON: "MALFORMED_JSON",

  // Authentication
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
  ACCOUNT_UNVERIFIED: "ACCOUNT_UNVERIFIED",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",

  // Authorization
  FORBIDDEN: "FORBIDDEN",

  // Platform authorization
  PLATFORM_ACCESS_DENIED: "PLATFORM_ACCESS_DENIED",
  RESIDENT_WEB_ACCESS_DENIED: "RESIDENT_WEB_ACCESS_DENIED",
  PLATFORM_CONTEXT_MISMATCH: "PLATFORM_CONTEXT_MISMATCH",

  // Not found
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  NOT_FOUND: "NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  APPOINTMENT_NOT_FOUND: "APPOINTMENT_NOT_FOUND",
  MISSION_NOT_FOUND: "MISSION_NOT_FOUND",
  NOTIFICATION_NOT_FOUND: "NOTIFICATION_NOT_FOUND",
  REGISTRATION_NOT_FOUND: "REGISTRATION_NOT_FOUND",

  // Conflict
  CONFLICT: "CONFLICT",
  DUPLICATE_RESOURCE: "DUPLICATE_RESOURCE",
  EMAIL_EXISTS: "EMAIL_EXISTS",
  ALREADY_VERIFIED: "ALREADY_VERIFIED",
  DUPLICATE_SCHEDULE: "DUPLICATE_SCHEDULE",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  TRIAGE_ORDER_VIOLATION: "TRIAGE_ORDER_VIOLATION",

  // OTP / registration flow
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_MAX_ATTEMPTS: "OTP_MAX_ATTEMPTS",
  OTP_COOLDOWN: "OTP_COOLDOWN",
  OTP_RATE_LIMITED: "OTP_RATE_LIMITED",
  INVALID_SESSION: "INVALID_SESSION",

  // Rate limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // Infrastructure
  DATABASE_ERROR: "DATABASE_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  EMAIL_SERVICE_LIMIT: "EMAIL_SERVICE_LIMIT",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
});

/**
 * Safe, user-facing messages for errors that are normalized centrally rather
 * than thrown with an explicit message.
 */
const SAFE_MESSAGES = Object.freeze({
  [ERROR_CODES.AUTHENTICATION_REQUIRED]:
    "Your session has expired. Please log in again.",
  [ERROR_CODES.TOKEN_EXPIRED]:
    "Your session has expired. Please log in again.",
  [ERROR_CODES.INVALID_TOKEN]:
    "Your session is no longer valid. Please log in again.",
  [ERROR_CODES.FORBIDDEN]:
    "You do not have permission to perform this action.",
  [ERROR_CODES.PLATFORM_ACCESS_DENIED]:
    "This account is not authorized to access this platform.",
  [ERROR_CODES.RESIDENT_WEB_ACCESS_DENIED]:
    "Resident accounts can only access MaslogCare through the mobile application.",
  [ERROR_CODES.PLATFORM_CONTEXT_MISMATCH]:
    "This session is not valid on this platform. Please log in again.",
  [ERROR_CODES.INVALID_ID]:
    "The requested record could not be found.",
  [ERROR_CODES.NOT_FOUND]:
    "The requested record could not be found.",
  [ERROR_CODES.ROUTE_NOT_FOUND]:
    "The requested endpoint could not be found.",
  [ERROR_CODES.DATABASE_ERROR]:
    "The service is temporarily unavailable. Please try again later.",
  [ERROR_CODES.SERVICE_UNAVAILABLE]:
    "The service is temporarily unavailable. Please try again later.",
  [ERROR_CODES.PAYLOAD_TOO_LARGE]:
    "The information you submitted is too large. Please use a smaller photo or shorter text.",
  [ERROR_CODES.MALFORMED_JSON]:
    "The request could not be read. Please try again.",
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]:
    "Too many requests. Please try again shortly.",
  [ERROR_CODES.INTERNAL_SERVER_ERROR]:
    "An unexpected error occurred. Please try again later.",
});

module.exports = {
  HTTP_STATUS,
  ERROR_CODES,
  SAFE_MESSAGES,
};
