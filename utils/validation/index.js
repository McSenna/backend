"use strict";

const {
  isValidEmail,
  validatePassword,
  validatePasswordStrength,
  isValidFullName,
  validateDateOfBirth,
  isValidAddress,
  isValidGender,
  isValidOTP,
} = require("./basicValidators");
const {
  isValidIdType,
  isValidIdNumber,
  isValidPhMobile,
  normalizePhMobile,
  isValidSuffix,
  isValidCivilStatus,
  isValidSex,
} = require("./identityValidators");
const { buildFullName, buildAddressLine, normalizeAddress } = require("./nameAndAddress");
const { validateRegistrationPayload } = require("./legacyRegistration");
const { isStructuredRegistration, validateResidentRegistration } = require("./residentRegistration");

module.exports = {
  isValidEmail,
  validatePassword,
  validatePasswordStrength,
  isValidFullName,
  validateDateOfBirth,
  isValidAddress,
  isValidGender,
  isValidOTP,
  validateRegistrationPayload,
  isValidPhMobile,
  normalizePhMobile,
  isValidSex,
  isValidCivilStatus,
  isValidSuffix,
  buildFullName,
  buildAddressLine,
  normalizeAddress,
  isStructuredRegistration,
  validateResidentRegistration,
  isValidIdType,
  isValidIdNumber,
};
