"use strict";

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const validatePassword = (password) => {
  const errors = [];
  if (!password || password.length < 8) errors.push("Password must be at least 8 characters long");
  if (!/[A-Za-z]/.test(password)) errors.push("Password must contain at least one letter");
  if (!/\d/.test(password)) errors.push("Password must contain at least one number");
  return { isValid: errors.length === 0, errors };
};

const validatePasswordStrength = (password) => {
  const errors = [];
  const value = String(password ?? "");

  if (value.length < 8) errors.push("Password must be at least 8 characters");
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value))
    errors.push("Password must contain uppercase and lowercase letters");
  if (!/\d/.test(value)) errors.push("Password must contain at least one number");
  if (!/[^A-Za-z0-9]/.test(value))
    errors.push("Password must contain at least one special character");

  return { isValid: errors.length === 0, errors };
};

const isValidFullName = (fullname) => {
  const len = fullname?.trim().length;
  return len >= 2 && len <= 100;
};

const validateDateOfBirth = (dateOfBirth) => {
  try {
    const date = new Date(dateOfBirth);
    const now = new Date();
    if (isNaN(date.getTime())) return { isValid: false, error: "Invalid date format" };
    if (date > now) return { isValid: false, error: "Date of birth cannot be in the future" };
    if (now.getFullYear() - date.getFullYear() < 1) {
      return { isValid: false, error: "Invalid date of birth" };
    }
    return { isValid: true };
  } catch {
    return { isValid: false, error: "Invalid date of birth" };
  }
};

const isValidAddress = (address) =>
  address && address.trim().length >= 5 && address.trim().length <= 255;

const isValidGender = (gender) => ["male", "female", "other"].includes(gender?.toLowerCase());

const isValidOTP = (otp) => /^\d{6}$/.test(String(otp).trim());

module.exports = {
  isValidEmail,
  validatePassword,
  validatePasswordStrength,
  isValidFullName,
  validateDateOfBirth,
  isValidAddress,
  isValidGender,
  isValidOTP,
};
