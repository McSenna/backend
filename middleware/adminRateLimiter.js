"use strict";

const { tooManyRequests } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const { SlidingWindowStore } = require("../utils/slidingWindowStore");

const MINUTE_MS = 60 * 1000;

// Keyed by the signed-in admin, so it does not depend on the proxy's address.
const buildAdminLimiter = (store, message) => (req, _res, next) => {
  const key = String(req.user.userId);
  if (!store.isLimited(key)) return next();
  const error = tooManyRequests(message, ERROR_CODES.RATE_LIMITED);
  error.details = { retryAfter: store.getRetryAfterSeconds(key) };
  return next(error);
};

const adminWriteLimiter = buildAdminLimiter(
  new SlidingWindowStore(MINUTE_MS, 60),
  "Too many changes in a short time. Wait a minute, then try again.",
);
const adminExportLimiter = buildAdminLimiter(
  new SlidingWindowStore(15 * MINUTE_MS, 5),
  "Too many exports in a short time. Wait a few minutes, then try again.",
);
const adminResetLimiter = buildAdminLimiter(
  new SlidingWindowStore(15 * MINUTE_MS, 5),
  "Too many password resets in a short time. Wait a few minutes, then try again.",
);

module.exports = { adminWriteLimiter, adminExportLimiter, adminResetLimiter };
