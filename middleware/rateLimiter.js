"use strict";

const { tooManyRequests } = require("../utils/AppError");
const { SlidingWindowStore, clientIpOf } = require("../utils/slidingWindowStore");
const logger = require("../utils/logger");

const otpSendIpStore = new SlidingWindowStore(15 * 60 * 1000, 15);
const otpSendEmailStore = new SlidingWindowStore(15 * 60 * 1000, 5);

const otpVerifyIpStore = new SlidingWindowStore(15 * 60 * 1000, 30);
const otpVerifyEmailStore = new SlidingWindowStore(15 * 60 * 1000, 10);

const loginIpStore = new SlidingWindowStore(15 * 60 * 1000, 30);
const loginEmailStore = new SlidingWindowStore(15 * 60 * 1000, 8);

const WINDOW_MINUTES = 15;

function targetEmail(req) {
  return String(req.body?.email || "").toLowerCase().trim();
}

function buildLimiter({ ipStore, emailStore, code, deviceMessage, accountMessage }) {
  return function rateLimit(req, _res, next) {
    const ipKey = clientIpOf(req);
    if (ipStore.isLimited(ipKey)) {
      const err = tooManyRequests(deviceMessage, code);
      if (typeof ipStore.getRetryAfterSeconds === "function") {
        const retryAfter = ipStore.getRetryAfterSeconds(ipKey);
        if (retryAfter > 0) err.details = { retryAfter };
      }
      logger.warn("Rate limiter: ip limit reached", { ip: ipKey, retryAfter: err.details?.retryAfter });
      return next(err);
    }

    const email = targetEmail(req);
    if (email && emailStore.isLimited(email)) {
      const err = tooManyRequests(accountMessage, code);
      if (typeof emailStore.getRetryAfterSeconds === "function") {
        const retryAfter = emailStore.getRetryAfterSeconds(email);
        if (retryAfter > 0) err.details = { retryAfter };
      }
      // The address stays out of the log: it is personal data, and the code says which limit hit.
      logger.warn("Rate limiter: email limit reached", { code, retryAfter: err.details?.retryAfter });
      return next(err);
    }

    return next();
  };
}

const otpSendRateLimiter = buildLimiter({
  ipStore: otpSendIpStore,
  emailStore: otpSendEmailStore,
  code: "OTP_RATE_LIMITED",
  deviceMessage: "Too many requests from this device. Please wait before trying again.",
  accountMessage:
    "Too many verification requests for this email. Please wait a few minutes before trying again.",
});

const otpVerifyRateLimiter = buildLimiter({
  ipStore: otpVerifyIpStore,
  emailStore: otpVerifyEmailStore,
  code: "OTP_RATE_LIMITED",
  deviceMessage: "Too many requests from this device. Please wait before trying again.",
  accountMessage:
    "Too many verification attempts for this email. Please wait a few minutes before trying again.",
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

module.exports = { otpSendRateLimiter, otpVerifyRateLimiter, loginRateLimiter, clearLoginAttempts };
