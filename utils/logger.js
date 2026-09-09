"use strict";

/**
 * Server-side logging for technical detail.
 *
 * Developer logs and user-facing messages are deliberately separate concerns:
 * everything here stays on the server. Keys that can carry credentials or
 * tokens are redacted so a stray metadata object never writes a secret to the
 * log stream.
 */

const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /^(password|newpassword|confirmpassword|currentpassword|otp|token|accesstoken|refreshtoken|authorization|cookie|jwt|secret|apikey|api_key|mongo_uri|mongouri|profilephoto|photo|profileimage)$/i;

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

const isProduction = () => process.env.NODE_ENV === "production";

function format(level, message, context) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? redact(context) : {}),
  };
  return JSON.stringify(line);
}

const logger = {
  info(message, context) {
    console.log(format("info", message, context));
  },

  warn(message, context) {
    console.warn(format("warn", message, context));
  },

  error(message, context) {
    console.error(format("error", message, context));
  },

  /**
   * Logs a failed request with the request context the on-call developer needs,
   * plus the stack trace outside production.
   */
  requestError(err, req, { statusCode, code, isOperational }) {
    const context = {
      method: req?.method,
      route: req?.originalUrl,
      statusCode,
      code,
      errorName: err?.name,
      errorMessage: err?.message,
      userId: req?.user?.userId ? String(req.user.userId) : undefined,
      role: req?.user?.role,
    };

    // A stack trace is only useful for a fault nobody anticipated. Attaching
    // one to every rejected login or validation failure buries the real
    // incidents in noise.
    if (!isProduction() && !isOperational && err?.stack) {
      context.stack = err.stack;
    }

    // 5xx means the server is at fault and deserves error level; 4xx is the
    // client's input and is only worth a warning.
    if (statusCode >= 500) {
      logger.error("Request failed", context);
    } else {
      logger.warn("Request rejected", context);
    }
  },

  redact,
};

module.exports = logger;
