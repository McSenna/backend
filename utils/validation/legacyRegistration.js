"use strict";

const {
  isValidEmail,
  validatePassword,
  isValidFullName,
  validateDateOfBirth,
  isValidAddress,
  isValidGender,
} = require("./basicValidators");

const validateRegistrationPayload = (data) => {
  const errors = [];

  if (!data.fullname) errors.push("Full name is required");
  else if (!isValidFullName(data.fullname)) {
    errors.push("Full name must be between 2 and 100 characters");
  }

  if (!data.email) errors.push("Email is required");
  else if (!isValidEmail(data.email)) errors.push("Invalid email format");

  if (!data.password) errors.push("Password is required");
  else {
    const { isValid, errors: pwErrors } = validatePassword(data.password);
    if (!isValid) errors.push(...pwErrors);
  }

  if (!data.gender) errors.push("Gender is required");
  else if (!isValidGender(data.gender)) errors.push("Gender must be male, female, or other");

  const dob = data.dateOfBirth || data.birthdate;
  if (!dob) errors.push("Date of birth is required");
  else {
    const { isValid, error } = validateDateOfBirth(dob);
    if (!isValid) errors.push(error);
  }

  if (!data.address) errors.push("Address is required");
  else if (!isValidAddress(data.address)) {
    errors.push("Address must be between 5 and 255 characters");
  }

  return { isValid: errors.length === 0, errors };
};

module.exports = { validateRegistrationPayload };
