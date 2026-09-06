"use strict";

const { EmailServiceError } = require("../services/mailer/errors");

class ApiError extends Error {
  constructor(statusCode, message, code = "API_ERROR") {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Centralized Express Error Handling Middleware
 */
const globalErrorHandler = (err, req, res, next) => {
  const isProd = process.env.NODE_ENV === "production";

  // 1. Email Service Errors (e.g. Quota exceeded, Auth failure)
  if (err instanceof EmailServiceError) {
    console.error(`[EMAIL ERROR] [${err.code}] ${err.message}`);
    return res.status(err.httpStatus).json({
      success: false,
      code: err.code,
      message: err.userMessage,
      ...(isProd ? {} : { details: err.message }),
    });
  }

  // 2. Custom Application Errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }

  // 3. Mongoose Validation Errors
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: errors[0] || "Validation failed",
      errors,
    });
  }

  // 4. Mongo Duplicate Key Error (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(409).json({
      success: false,
      code: "DUPLICATE_RESOURCE",
      message: `An account with this ${field} already exists`,
    });
  }

  // 5. JWT Errors
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      code: "INVALID_TOKEN",
      message: "Session expired or invalid token. Please log in again.",
    });
  }

  // 6. Generic Fallback
  const statusCode = err.statusCode || err.status || 500;
  const message = isProd
    ? "An unexpected error occurred. Please try again later."
    : err.message || "Internal server error";

  console.error(`[SERVER ERROR] [${statusCode}]:`, err);

  return res.status(statusCode).json({
    success: false,
    code: err.code || "INTERNAL_SERVER_ERROR",
    message,
    ...(isProd ? {} : { stack: err.stack }),
  });
};

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  ApiError,
  globalErrorHandler,
  asyncHandler,
};