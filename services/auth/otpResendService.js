"use strict";

const User = require("../../models/User");
const PendingRegistration = require("../../models/register");
const { generateOTP } = require("../../utils/otpGenerator");
const { badRequest, notFound, conflict, tooManyRequests } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const {
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  deliverOtpEmail,
} = require("./otpDelivery");

const assertCooldownElapsed = (pending) => {
  const lastSent = pending.lastOtpSentAt ? new Date(pending.lastOtpSentAt).getTime() : 0;
  const elapsedSeconds = Math.floor((Date.now() - lastSent) / 1000);
  if (elapsedSeconds >= OTP_RESEND_COOLDOWN_SECONDS) return;

  const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
  const error = tooManyRequests(
    `Please wait ${waitSeconds} second${waitSeconds === 1 ? "" : "s"} before requesting another verification code.`,
    ERROR_CODES.OTP_COOLDOWN
  );
  error.details = { retryAfter: waitSeconds };
  throw error;
};

const resendOtp = async (email) => {
  if (!email) {
    throw badRequest("Email is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await User.findOne({ email: normalizedEmail }).lean();
  if (existingUser && existingUser.verified) {
    throw conflict(
      "This account is already registered and verified. Please log in.",
      ERROR_CODES.ALREADY_VERIFIED
    );
  }

  const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select(
    "+otp +otpExpires +lastOtpSentAt +verificationAttempts"
  );

  if (!pending) {
    throw notFound(
      "No pending registration found. Please register first.",
      ERROR_CODES.REGISTRATION_NOT_FOUND
    );
  }

  assertCooldownElapsed(pending);

  const newOtp = generateOTP();
  pending.otp = newOtp;
  pending.otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  pending.lastOtpSentAt = new Date();
  pending.verificationAttempts = 0;
  await pending.save();

  await deliverOtpEmail(normalizedEmail, newOtp, pending.fullname);
};

module.exports = { resendOtp };
