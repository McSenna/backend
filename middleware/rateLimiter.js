"use strict";

const { tooManyRequests } = require("../utils/AppError");
const { SlidingWindowStore, clientIpOf } = require("../utils/slidingWindowStore");

const otpIpStore = new SlidingWindowStore(15 * 60 * 1000, 15);
const otpEmailStore = new SlidingWindowStore(15 * 60 * 1000, 5);

const loginIpStore = new SlidingWindowStore(15 * 60 * 1000, 30);
const loginEmailStore = new SlidingWindowStore(15 * 60 * 1000, 8);

const WINDOW_MINUTES = 15;

function targetEmail(req) {
  return String(req.body?.email || "").toLowerCase().trim();
}

function buildLimiter({ ipStore, emailStore, code, deviceMessage, accountMessage }) {
  return function rateLimit(req, _res, next) {
    if (ipStore.isLimited(clientIpOf(req))) {
      return next(tooManyRequests(deviceMessage, code));
    }

    const email = targetEmail(req);
    if (email && emailStore.isLimited(email)) {
      return next(tooManyRequests(accountMessage, code));
    }

    return next();
  };
}

const otpRateLimiter = buildLimiter({
  ipStore: otpIpStore,
  emailStore: otpEmailStore,
  code: "OTP_RATE_LIMITED",
  deviceMessage: "Too many requests from this device. Please wait before trying again.",
  accountMessage:
    "Too many verification requests for this email. Please wait a few minutes before trying again.",
});

const loginRateLimiter = buildLimiter({
  ipStore: loginIpStore,
  emailStore: loginEmailStore,
  code: "LOGIN_RATE_LIMITED",
  deviceMessage: `Too many sign-in attempts from this device. Please wait ${WINDOW_MINUTES} minutes and try again.`,
  accountMessage: `Too many sign-in attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`,
});

function clearLoginAttempts(email) {
  const key = String(email || "").toLowerCase().trim();
  if (key) loginEmailStore.reset(key);
}

module.exports = { otpRateLimiter, loginRateLimiter, clearLoginAttempts };
