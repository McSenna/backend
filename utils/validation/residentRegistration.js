"use strict";

const {
  isValidEmail,
  validatePasswordStrength,
  validateDateOfBirth,
} = require("./basicValidators");
const {
  isValidIdType,
  isValidIdNumber,
  isValidPhMobile,
  isValidNamePart,
  isValidSuffix,
  isValidCivilStatus,
  isValidSex,
} = require("./identityValidators");
const { buildFullName, buildAddressLine, normalizeAddress } = require("./nameAndAddress");

const isStructuredRegistration = (data = {}) =>
  Boolean(data.firstName || data.surname || data.address?.barangay);

const checkNames = (data, fail) => {
  if (!String(data.firstName ?? "").trim()) fail("firstName", "First name is required");
  else if (!isValidNamePart(data.firstName, { required: true })) {
    fail("firstName", "Please enter a valid first name");
  }

  if (!isValidNamePart(data.middleName, { required: false })) {
    fail("middleName", "Please enter a valid middle name");
  }

  if (!String(data.surname ?? "").trim()) fail("surname", "Surname is required");
  else if (!isValidNamePart(data.surname, { required: true })) {
    fail("surname", "Please enter a valid surname");
  }

  if (!isValidSuffix(data.suffix)) {
    fail("suffix", "Please enter a valid suffix, such as Jr. or III");
  }

  const composedName = buildFullName(data.firstName, data.middleName, data.surname, data.suffix);
  if (composedName.length > 100) {
    fail("surname", "Your full name must not exceed 100 characters");
  }
};

const checkPersonalDetails = (data, fail) => {
  const dob = data.dateOfBirth || data.birthdate;
  if (!dob) fail("dateOfBirth", "Date of birth is required");
  else {
    const { isValid, error } = validateDateOfBirth(dob);
    if (!isValid) fail("dateOfBirth", error);
  }

  const sex = data.sex || data.gender;
  if (!sex) fail("sex", "Sex is required");
  else if (!isValidSex(sex)) fail("sex", "Sex must be male or female");

  if (!isValidCivilStatus(data.civilStatus)) {
    fail("civilStatus", "Civil status must be single, married, widowed, or separated");
  }
};

const checkCredentials = (data, fail) => {
  const contactNumber = data.contactNumber || data.phone;
  if (!contactNumber) fail("contactNumber", "Contact number is required");
  else if (!isValidPhMobile(contactNumber)) {
    fail("contactNumber", "Please enter a valid Philippine mobile number");
  }

  if (!data.email) fail("email", "Email is required");
  else if (!isValidEmail(data.email)) fail("email", "Please enter a valid email address");

  if (!data.password) fail("password", "Password is required");
  else {
    const { isValid, errors: passwordErrors } = validatePasswordStrength(data.password);
    if (!isValid) fail("password", passwordErrors[0]);
  }
};

const checkAddress = (data, fail) => {
  const address = data.address ?? {};
  if (typeof address !== "object" || Array.isArray(address)) {
    fail("address", "Address is required");
    return;
  }

  if (!String(address.cityMunicipality ?? "").trim()) {
    fail("address.cityMunicipality", "City / Municipality is required");
  }
  if (!String(address.province ?? "").trim()) {
    fail("address.province", "Province is required");
  }

  const line = buildAddressLine(normalizeAddress(address));
  if (line.length > 255) fail("address", "Address must not exceed 255 characters");
};

const checkGovernmentId = (data, fail) => {
  if (!String(data.idType ?? "").trim()) {
    fail("idType", "ID Type is required");
  } else if (!isValidIdType(data.idType)) {
    fail("idType", "Please select a valid accepted ID Type");
  }

  if (!String(data.idNumber ?? "").trim()) {
    fail("idNumber", "ID Number is required");
  } else if (!isValidIdNumber(data.idNumber)) {
    fail("idNumber", "Please enter a valid ID Number between 3 and 50 characters");
  }

  if (!data.idDocument && !data.idFile && !data.uploadedId) {
    fail("idDocument", "Valid Government ID upload is required (JPG, PNG, or PDF)");
  }
};

const validateResidentRegistration = (data = {}) => {
  const errors = [];
  const fieldErrors = {};

  const fail = (field, message) => {
    fieldErrors[field] = fieldErrors[field] ?? message;
    errors.push(message);
  };

  checkNames(data, fail);
  checkPersonalDetails(data, fail);
  checkCredentials(data, fail);
  checkAddress(data, fail);
  checkGovernmentId(data, fail);

  return { isValid: errors.length === 0, errors, fieldErrors };
};

module.exports = { isStructuredRegistration, validateResidentRegistration };
