"use strict";

const User = require("../../models/User");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const RECORD_TTL_MINUTES = 60;

const TOKEN_TTL_MINUTES = 60;

const OTP_SELECT = "+otp +otpExpires +lastOtpSentAt +attempts +verificationToken +tokenExpires";

const normalizeEmail = (email) => String(email ?? "").toLowerCase().trim();

const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

const assertEmailAvailable = async (email) => {
  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw conflict(
      "An account with this email already exists. Please log in instead.",
      ERROR_CODES.EMAIL_EXISTS
    );
  }
};

module.exports = {
  RECORD_TTL_MINUTES,
  TOKEN_TTL_MINUTES,
  OTP_SELECT,
  normalizeEmail,
  minutesFromNow,
  assertEmailAvailable,
};
