"use strict";

const {
  validateRegistrationPayload,
  validateResidentRegistration,
  isStructuredRegistration,
  normalizeAddress,
  normalizePhMobile,
  buildAddressLine,
  buildFullName,
} = require("../../utils/validation");
const { validationFailed } = require("../../utils/AppError");

const resolveLegacyProfile = (body) => {
  const dob = body.dateOfBirth || body.birthdate;
  const validation = validateRegistrationPayload({
    fullname: body.fullname,
    email: body.email,
    password: body.password,
    gender: body.gender,
    dateOfBirth: dob,
    address: body.address,
  });

  if (!validation.isValid) {
    throw validationFailed(validation.errors[0], validation.errors);
  }

  return {
    fullname: body.fullname.trim(),
    email: body.email.toLowerCase().trim(),
    password: body.password,
    gender: body.gender.toLowerCase(),
    dateOfBirth: new Date(dob),
    address: body.address.trim(),
  };
};

const resolveStructuredProfile = (body) => {
  const validation = validateResidentRegistration(body);
  if (!validation.isValid) {
    const error = validationFailed(validation.errors[0], validation.errors);
    error.details = { ...(error.details ?? {}), fieldErrors: validation.fieldErrors };
    throw error;
  }

  const firstName = body.firstName.trim();
  const middleName = String(body.middleName ?? "").trim();
  const surname = body.surname.trim();
  const suffix = String(body.suffix ?? "").trim();
  const addressDetails = normalizeAddress(body.address);

  return {
    firstName,
    middleName,
    surname,
    suffix,
    fullname: buildFullName(firstName, middleName, surname, suffix),
    email: body.email.toLowerCase().trim(),
    password: body.password,
    gender: String(body.sex ?? body.gender).toLowerCase().trim(),
    civilStatus: String(body.civilStatus ?? "").toLowerCase().trim(),
    dateOfBirth: new Date(body.dateOfBirth || body.birthdate),
    phone: normalizePhMobile(body.contactNumber ?? body.phone),
    addressDetails,
    address: buildAddressLine(addressDetails),
  };
};

const resolveRegistrationProfile = (body) =>
  isStructuredRegistration(body) ? resolveStructuredProfile(body) : resolveLegacyProfile(body);

module.exports = { resolveRegistrationProfile };
