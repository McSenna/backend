"use strict";

const { COMMON_FIELDS, FOLLOW_UP_FIELDS, getServiceFields } = require("../config/medicalRecordFields");

const MAX_TEXT = 4000;

function coerceText(value, maxLength = MAX_TEXT) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function coerceNumber(field, value, errors) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${field.label} must be a number.`);
    return undefined;
  }
  if (typeof field.min === "number" && n < field.min) {
    errors.push(`${field.label} must be at least ${field.min}.`);
    return undefined;
  }
  if (typeof field.max === "number" && n > field.max) {
    errors.push(`${field.label} must be at most ${field.max}.`);
    return undefined;
  }
  return n;
}

function coerceDate(field, value, errors) {
  if (value === null || value === undefined || value === "") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    errors.push(`${field.label} is not a valid date.`);
    return undefined;
  }
  return d;
}

function coerceSelect(field, value, errors) {
  if (value === null || value === undefined || value === "") return undefined;
  const allowed = (field.options || []).map((o) => o.value);
  const v = String(value);
  if (!allowed.includes(v)) {
    errors.push(`${field.label} is not one of the available choices.`);
    return undefined;
  }
  return v;
}

function coerceField(field, value, errors) {
  switch (field.type) {
    case "number":
      return coerceNumber(field, value, errors);
    case "date":
      return coerceDate(field, value, errors);
    case "select":
      return coerceSelect(field, value, errors);
    case "boolean":
      return value === true || value === "true";
    case "text":
    case "textarea":
    default: {
      const text = coerceText(value, field.maxLength ?? MAX_TEXT);
      return text === "" ? undefined : text;
    }
  }
}

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function validateMedicalRecordInput(categoryKey, input) {
  const errors = [];
  const body = input && typeof input === "object" ? input : {};

  const read = (field, raw) => {
    const before = errors.length;
    const value = coerceField(field, raw, errors);
    const failed = errors.length > before;
    if (field.required && isMissing(value) && !failed) {
      errors.push(`${field.label} is required.`);
    }
    return value;
  };

  const common = {};
  for (const field of COMMON_FIELDS) {
    const value = read(field, body[field.key]);
    common[field.key] = value === undefined ? "" : value;
  }

  const serviceDetails = {};
  for (const field of getServiceFields(categoryKey)) {
    const value = read(field, body.serviceDetails?.[field.key]);
    if (value !== undefined) serviceDetails[field.key] = value;
  }

  const followUpRequired = body.followUpRequired === true || body.followUpRequired === "true";
  const followUpField = FOLLOW_UP_FIELDS.find((f) => f.key === "followUpDate");
  let followUpDate = coerceDate(followUpField, body.followUpDate, errors);

  if (!followUpRequired && followUpDate) {
    followUpDate = undefined;
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      ...common,
      serviceDetails,
      followUpRequired,
      followUpDate: followUpDate ?? null,
    },
  };
}

module.exports = { validateMedicalRecordInput, coerceText };
