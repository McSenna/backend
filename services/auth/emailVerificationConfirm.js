"use strict";

const crypto = require("crypto");
const EmailVerification = require("../../models/EmailVerification");
const { isValidOTP } = require("../../utils/validation");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { OTP_MAX_VERIFY_ATTEMPTS } = require("./otpDelivery");
const {
  TOKEN_TTL_MINUTES,
  OTP_SELECT,
  normalizeEmail,
  minutesFromNow,
  assertEmailAvailable,
} = require("./emailVerificationCore");

const notVerified = (message) => badRequest(message, ERROR_CODES.EMAIL_NOT_VERIFIED);

const loadRecord = async (email) => {
  const record = await EmailVerification.findOne({ email }).select(OTP_SELECT);
  if (!record) {
    throw badRequest(
      "No verification code was requested for this email. Please request a new code.",
      ERROR_CODES.OTP_INVALID
    );
  }
  return record;
};

const assertAttemptsRemaining = (record) => {
  if ((record.attempts || 0) < OTP_MAX_VERIFY_ATTEMPTS) return;
  throw badRequest(
    "Too many incorrect attempts. Please request a new verification code.",
    ERROR_CODES.OTP_MAX_ATTEMPTS
  );
};

const registerFailedAttempt = async (record) => {
  record.attempts = (record.attempts || 0) + 1;
  await record.save();

  const remaining = OTP_MAX_VERIFY_ATTEMPTS - record.attempts;
  if (remaining <= 0) {
    throw badRequest(
      "Too many incorrect attempts. Please request a new verification code.",
      ERROR_CODES.OTP_MAX_ATTEMPTS
    );
  }

  const error = badRequest(
    `Incorrect verification code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
    ERROR_CODES.OTP_INVALID
  );
  error.details = { remainingAttempts: remaining };
  throw error;
};

const confirmEmailVerification = async ({ email: rawEmail, otp }) => {
  const email = normalizeEmail(rawEmail);

  if (!email || !otp) {
    throw badRequest("Email and verification code are required.", ERROR_CODES.MISSING_FIELDS);
  }
  if (!isValidOTP(String(otp).trim())) {
    throw badRequest("Verification code must be 6 digits.", ERROR_CODES.INVALID_FORMAT);
  }

  await assertEmailAvailable(email);

  const record = await loadRecord(email);
  assertAttemptsRemaining(record);

  if (!record.otpExpires || record.otpExpires.getTime() < Date.now()) {
    throw badRequest(
      "This verification code has expired. Please request a new one.",
      ERROR_CODES.OTP_EXPIRED
    );
  }

  if (!(await record.matchesOtp(otp))) {
    await registerFailedAttempt(record);
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");

  record.otp = undefined;
  record.otpExpires = undefined;
  record.attempts = 0;
  record.verified = true;
  record.verifiedAt = new Date();
  record.verificationToken = verificationToken;
  record.tokenExpires = minutesFromNow(TOKEN_TTL_MINUTES);
  record.consumedAt = undefined;
  await record.save();

  return { email, verificationToken, expiresInMinutes: TOKEN_TTL_MINUTES };
};

const tokensMatch = (candidate, stored) => {
  const a = Buffer.from(String(candidate ?? ""));
  const b = Buffer.from(String(stored ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const consumeEmailVerification = async ({ email: rawEmail, verificationToken }) => {
  const email = normalizeEmail(rawEmail);

  if (!verificationToken) {
    throw notVerified("Please verify your email address before submitting your registration.");
  }

  const record = await EmailVerification.findOne({ email }).select(OTP_SELECT);

  if (!record || !record.verified || !record.verificationToken) {
    throw notVerified("Please verify your email address before submitting your registration.");
  }

  if (record.consumedAt) {
    throw notVerified("This email verification has already been used. Please verify again.");
  }

  if (!record.tokenExpires || record.tokenExpires.getTime() < Date.now()) {
    throw badRequest(
      "Your email verification has expired. Please verify your email again.",
      ERROR_CODES.EMAIL_VERIFICATION_EXPIRED
    );
  }

  if (!tokensMatch(verificationToken, record.verificationToken)) {
    throw notVerified("Email verification failed. Please verify your email again.");
  }

  record.consumedAt = new Date();
  await record.save();

  return true;
};

module.exports = { confirmEmailVerification, consumeEmailVerification };
