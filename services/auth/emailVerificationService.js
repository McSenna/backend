"use strict";

const EmailVerification = require("../../models/EmailVerification");
const { generateOTP } = require("../../utils/otpGenerator");
const { isValidEmail } = require("../../utils/validation");
const { badRequest, tooManyRequests } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const {
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  deliverOtpEmail,
} = require("./otpDelivery");
const {
  RECORD_TTL_MINUTES,
  OTP_SELECT,
  normalizeEmail,
  minutesFromNow,
  assertEmailAvailable,
} = require("./emailVerificationCore");

const assertCooldownElapsed = (record) => {
  if (!record?.lastOtpSentAt) return;

  const elapsed = Math.floor((Date.now() - new Date(record.lastOtpSentAt).getTime()) / 1000);
  if (elapsed >= OTP_RESEND_COOLDOWN_SECONDS) return;

  const retryAfter = OTP_RESEND_COOLDOWN_SECONDS - elapsed;
  const error = tooManyRequests(
    `Please wait ${retryAfter} second${retryAfter === 1 ? "" : "s"} before requesting another code.`,
    ERROR_CODES.OTP_COOLDOWN
  );
  error.details = { retryAfter };
  throw error;
};

const sendEmailVerification = async (rawEmail) => {
  const email = normalizeEmail(rawEmail);

  if (!email) throw badRequest("Email is required.", ERROR_CODES.MISSING_FIELDS);
  if (!isValidEmail(email)) {
    throw badRequest("Please enter a valid email address.", ERROR_CODES.INVALID_FORMAT);
  }

  await assertEmailAvailable(email);

  const record =
    (await EmailVerification.findOne({ email }).select(OTP_SELECT)) ??
    new EmailVerification({ email, expiresAt: minutesFromNow(RECORD_TTL_MINUTES) });

  assertCooldownElapsed(record);

  record.otp = generateOTP();
  record.otpExpires = minutesFromNow(OTP_EXPIRY_MINUTES);
  record.lastOtpSentAt = new Date();
  record.attempts = 0;
  record.verified = false;
  record.verifiedAt = undefined;
  record.verificationToken = undefined;
  record.tokenExpires = undefined;
  record.consumedAt = undefined;
  record.expiresAt = minutesFromNow(RECORD_TTL_MINUTES);

  const plainOtp = record.otp;
  await record.save();
  await deliverOtpEmail(email, plainOtp, "");

  return {
    email,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
};

module.exports = { sendEmailVerification };
