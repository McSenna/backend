"use strict";

const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { normalizeProfilePhoto } = require("../../utils/profilePhoto");
const {
  buildFullName,
  isValidAddress,
  isValidFullName,
  isValidPhMobile,
  normalizePhMobile,
  validateDateOfBirth,
} = require("../../utils/validation");

const EDITABLE_FIELDS = [
  "fullname",
  "firstName",
  "middleName",
  "surname",
  "dateOfBirth",
  "phone",
  "address",
  "profilePhoto",
];

const NAME_PARTS = {
  firstName: { label: "First name", required: true },
  middleName: { label: "Middle name", required: false },
  surname: { label: "Last name", required: true },
};

const invalid = (message) => badRequest(message, ERROR_CODES.VALIDATION_ERROR);

const GENDER_LOCKED_MESSAGE = "Gender is set when the account is registered and cannot be changed.";
const normalizeGender = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Gender is recorded once, at registration, and never edited afterwards. A form
 * that sends back the value already stored is accepted (nothing changes); any
 * other value is refused, so no client can rewrite it.
 */
const assertGenderUnchanged = (body, current) => {
  if (!("gender" in body)) return;
  if (normalizeGender(body.gender) !== normalizeGender(current.gender)) throw invalid(GENDER_LOCKED_MESSAGE);
};

const readNamePart = (body, field) => {
  const { label, required } = NAME_PARTS[field];
  const value = String(body[field] ?? "").trim();

  if (required && value.length < 2) {
    throw invalid(`${label} must be at least 2 characters.`);
  }
  if (value.length > 50) {
    throw invalid(`${label} must not exceed 50 characters.`);
  }

  return value;
};

const resolveFullName = (body, update, current) => {
  const touchedParts = Object.keys(NAME_PARTS).some((field) => field in update);

  if (touchedParts) {
    return buildFullName(
      update.firstName ?? current.firstName,
      update.middleName ?? current.middleName,
      update.surname ?? current.surname,
      current.suffix
    );
  }

  return "fullname" in body ? String(body.fullname ?? "").trim() : null;
};

/** First word, last word, and whatever sits between, leaving a stored suffix out of the surname. */
const namePartsFromFullName = (fullname, suffix = "") => {
  const words = fullname.trim().split(/\s+/);
  if (suffix && words.length > 1 && words[words.length - 1].toLowerCase() === suffix.trim().toLowerCase()) words.pop();
  return {
    firstName: words[0],
    middleName: words.slice(1, -1).join(" "),
    surname: words.length > 1 ? words[words.length - 1] : "",
  };
};

const buildProfileUpdate = (body, current) => {
  assertGenderUnchanged(body, current);
  const update = {};

  Object.keys(NAME_PARTS).forEach((field) => {
    if (field in body) update[field] = readNamePart(body, field);
  });

  if ("dateOfBirth" in body) {
    const result = validateDateOfBirth(body.dateOfBirth);
    if (!result.isValid) throw invalid(result.error);
    update.dateOfBirth = new Date(body.dateOfBirth);
  }

  if ("phone" in body) {
    const phone = String(body.phone ?? "").trim();
    if (phone && !isValidPhMobile(phone)) {
      throw invalid("Please provide a valid PH mobile number.");
    }
    update.phone = phone ? normalizePhMobile(phone) : "";
  }

  if ("address" in body) {
    const address = String(body.address ?? "").trim();
    if (!isValidAddress(address)) {
      throw invalid("Address must be between 5 and 255 characters.");
    }
    update.address = address;
  }

  if ("profilePhoto" in body) {
    const normalized = normalizeProfilePhoto(body.profilePhoto);
    if (!normalized.ok) {
      throw badRequest(normalized.message, ERROR_CODES.INVALID_PHOTO);
    }
    update.profilePhoto = normalized.profilePhoto;
  }

  const fullname = resolveFullName(body, update, current);
  if (fullname !== null) {
    if (!isValidFullName(fullname)) {
      throw invalid("Full name must be between 2 and 100 characters.");
    }
    update.fullname = fullname;
  }

  return update;
};

module.exports = { EDITABLE_FIELDS, GENDER_LOCKED_MESSAGE, assertGenderUnchanged, buildProfileUpdate, namePartsFromFullName };
