"use strict";

const { createHash } = require("crypto");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const IDENTITY_FIELDS = Object.freeze([
  "firstName", "middleName", "lastName", "suffix", "dateOfBirth",
  "sex", "civilStatus", "barangay", "address",
]);
const IDENTITY_INDEX = "master_resident_personal_information_unique";
const DUPLICATE_MESSAGE = "This resident is already on the masterlist.";

// Exact comparison only. Preserve punctuation, internal whitespace and leading
// zeros. Optional missing names and suffixes compare as empty strings. Neither
// account status nor record status participates in identity.
const residentIdentityKey = (record) => createHash("sha256").update(JSON.stringify(
  IDENTITY_FIELDS.map((field) => field === "dateOfBirth"
    ? new Date(record[field]).toISOString().slice(0, 10)
    : String(record[field] ?? "").trim().toLowerCase())
)).digest("hex");

const duplicateResidentError = () => {
  const error = conflict(DUPLICATE_MESSAGE, ERROR_CODES.DUPLICATE_RESOURCE);
  error.details = { fieldErrors: Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, DUPLICATE_MESSAGE])) };
  return error;
};
const duplicateIdError = () => {
  const error = conflict("A master list record with this ID already exists.", ERROR_CODES.DUPLICATE_RESOURCE);
  error.details = { fieldErrors: { masterResidentId: "This master resident ID is already on the list." } };
  return error;
};

// Never turn an unrelated database failure into a duplicate validation error.
const translateDuplicateError = (error) => {
  if (error?.code !== 11000) return error;
  if (error.keyPattern?.identityKey || error.message?.includes(IDENTITY_INDEX)) return duplicateResidentError();
  if (error.keyPattern?.masterResidentId || error.message?.includes("masterResidentId_1")) return duplicateIdError();
  return error;
};

module.exports = { IDENTITY_FIELDS, IDENTITY_INDEX, DUPLICATE_MESSAGE, residentIdentityKey, duplicateResidentError, duplicateIdError, translateDuplicateError };
