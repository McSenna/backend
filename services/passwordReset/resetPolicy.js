"use strict";

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 45;
const MAX_VERIFY_ATTEMPTS = 5;

const NEUTRAL_SEND_MESSAGE =
  "If an account is associated with this email, a verification code has been sent.";

const INVALID_CODE_MESSAGE = "The verification code is incorrect or has expired.";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const isValidEmail = (value) => /^\S+@\S+\.\S+$/.test(value);

const isSixDigitCode = (value) => /^\d{6}$/.test(value);

const readCode = (body) => String(body?.code || body?.otp || "").trim();

const validatePasswordStrength = (password) => {
  const problems = [];
  if (password.length < 8) problems.push("Password must be at least 8 characters.");
  if (!/[a-z]/.test(password)) problems.push("Password must contain a lowercase letter.");
  if (!/[A-Z]/.test(password)) problems.push("Password must contain an uppercase letter.");
  if (!/\d/.test(password)) problems.push("Password must contain a number.");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("Password must contain a special character.");
  return problems;
};

module.exports = {
  OTP_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  MAX_VERIFY_ATTEMPTS,
  NEUTRAL_SEND_MESSAGE,
  INVALID_CODE_MESSAGE,
  normalizeEmail,
  isValidEmail,
  isSixDigitCode,
  readCode,
  validatePasswordStrength,
};
