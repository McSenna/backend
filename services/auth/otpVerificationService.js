"use strict";

const User = require("../../models/User");
const PendingRegistration = require("../../models/register");
const { isValidOTP } = require("../../utils/validation");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { OTP_MAX_VERIFY_ATTEMPTS } = require("./otpDelivery");

const maxAttemptsError = () =>
  badRequest(
    "Maximum verification attempts exceeded. Please register again.",
    ERROR_CODES.OTP_MAX_ATTEMPTS
  );

const loadPendingOrFail = async (normalizedEmail) => {
  const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select(
    "+password +otp +otpExpires +verificationAttempts"
  );

  if (!pending) {
    throw badRequest(
      "No pending verification found. Your session may have expired. Please register again.",
      ERROR_CODES.INVALID_SESSION
    );
  }
  return pending;
};

const assertOtpMatches = async (pending, otp) => {
  const currentAttempts = pending.verificationAttempts || 0;
  if (currentAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    throw maxAttemptsError();
  }

  if (await pending.verifyOtp(otp)) return;

  pending.verificationAttempts = currentAttempts + 1;
  await pending.save();

  const remainingAttempts = OTP_MAX_VERIFY_ATTEMPTS - pending.verificationAttempts;
  if (remainingAttempts <= 0) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    throw maxAttemptsError();
  }

  const error = badRequest(
    `Incorrect verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`,
    ERROR_CODES.OTP_INVALID
  );
  error.details = { remainingAttempts };
  throw error;
};

const createVerifiedResident = (pending) =>
  User.create({
    firstName: pending.firstName || "",
    middleName: pending.middleName || "",
    surname: pending.surname || "",
    suffix: pending.suffix || "",
    fullname: pending.fullname,
    email: pending.email,
    password: pending.password,
    gender: pending.gender,
    civilStatus: pending.civilStatus || "",
    dateOfBirth: pending.dateOfBirth,
    address: pending.address,
    addressDetails: pending.addressDetails?.toObject?.() ?? pending.addressDetails,
    phone: pending.phone || "",
    verified: true,
    role: "resident",
    profilePhoto: pending.profilePhoto || "",
  });

const verifyRegistrationOtp = async ({ email, otp }) => {
  if (!email || !otp) {
    throw badRequest("Email and verification code are required.", ERROR_CODES.MISSING_FIELDS);
  }
  if (!isValidOTP(otp)) {
    throw badRequest("Verification code must be 6 digits.", ERROR_CODES.INVALID_FORMAT);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const pending = await loadPendingOrFail(normalizedEmail);

  if (new Date() > new Date(pending.otpExpires)) {
    throw badRequest(
      "Verification code has expired. Please request a new code.",
      ERROR_CODES.OTP_EXPIRED
    );
  }

  await assertOtpMatches(pending, otp);

  const user = await createVerifiedResident(pending);
  await PendingRegistration.deleteOne({ _id: pending._id });

  return user;
};

module.exports = { verifyRegistrationOtp };
