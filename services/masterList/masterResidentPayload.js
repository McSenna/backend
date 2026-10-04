"use strict";

// Reads the official fields an admin may set on a master list record. Anything
// else in the request (role, isActive, matchKeys, audit fields, account data)
// is ignored, so a request can never smuggle account or status data in.

const crypto = require("crypto");
const MasterResident = require("../../models/MasterResident");
const { RESIDENCY } = require("../../config/residency");
const { validationFailed } = require("../../utils/AppError");
const { parseCalendarDate } = require("../../utils/calendarDate");

const OFFICIAL_FIELDS = Object.freeze([
  "firstName",
  "middleName",
  "lastName",
  "suffix",
  "dateOfBirth",
  "sex",
  "civilStatus",
  "barangay",
  "address",
]);

const readOfficialFields = (body = {}) => {
  const fields = {};
  const fieldErrors = {};

  for (const field of OFFICIAL_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];

    if (field === "dateOfBirth") {
      const date = parseCalendarDate(value);
      if (date) fields.dateOfBirth = date;
      else fieldErrors.dateOfBirth = "Enter the birth date as YYYY-MM-DD, for example 1990-04-12";
      continue;
    }

    if (value === null || value === undefined) fields[field] = "";
    else if (typeof value === "string") fields[field] = value.trim();
    else fieldErrors[field] = "This value must be text";
  }

  return { fields, fieldErrors };
};

const readMasterResidentId = (value) => (typeof value === "string" ? value.trim() : "");

// Used when the barangay's registry has no ID of its own for the person.
const generateMasterResidentId = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `MSL-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await MasterResident.exists({ masterResidentId: candidate }))) return candidate;
  }
  throw new Error("Could not generate a unique master resident ID");
};

const fieldErrorsOf = (error) =>
  Object.fromEntries(
    Object.entries(error?.errors ?? {}).map(([path, detail]) => [path, detail.message])
  );

// Collects schema errors without echoing submitted values back.
const validateRecord = async (doc) => {
  try {
    await doc.validate();
    return {};
  } catch (error) {
    if (error?.name !== "ValidationError") throw error;
    return fieldErrorsOf(error);
  }
};

const assertNoFieldErrors = (fieldErrors) => {
  const messages = Object.values(fieldErrors);
  if (messages.length === 0) return;
  const error = validationFailed(messages[0], messages);
  error.details = { ...(error.details ?? {}), fieldErrors };
  throw error;
};

const buildNewRecord = async (body, adminId) => {
  const { fields, fieldErrors } = readOfficialFields(body);
  const masterResidentId =
    readMasterResidentId(body?.masterResidentId) || (await generateMasterResidentId());

  const doc = new MasterResident({
    ...fields,
    barangay: fields.barangay || RESIDENCY.barangay,
    masterResidentId,
    createdBy: adminId,
    updatedBy: adminId,
  });

  return { doc, fieldErrors: { ...(await validateRecord(doc)), ...fieldErrors } };
};

module.exports = {
  OFFICIAL_FIELDS,
  readOfficialFields,
  buildNewRecord,
  validateRecord,
  assertNoFieldErrors,
};
