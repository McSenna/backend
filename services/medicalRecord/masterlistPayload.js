"use strict";

// Reads an encoded medical record from a request. Only the fields listed here
// are taken; audit fields, `source: "appointment"`, account IDs or revisions in
// the body are ignored or refused. Error messages never echo what was typed,
// because the error handler logs every message.

const { ENCODABLE_SOURCES, MEDICAL_RECORD_SOURCES } = require("../../config/medicalRecordSources");
const { STAFF_ROLES } = require("../../models/medicalRecord/encodedFields");
const { validateMedicalRecordInput, coerceText } = require("../../utils/medicalRecordValidation");
const { parseCalendarDate } = require("../../utils/calendarDate");
const { validationFailed } = require("../../utils/AppError");

const MASTER_ID = /^[A-Za-z0-9-]{3,40}$/;
const EARLIEST_VISIT = Date.UTC(1900, 0, 1);
const OPTIONAL_FOR_ENCODED = Object.freeze(["assessment"]);

const textFor = (body, key, max, fieldErrors, label) => {
  const raw = body[key];
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") {
    fieldErrors[key] = `${label} must be text.`;
    return "";
  }
  if (raw.trim().length > max) fieldErrors[key] = `${label} must be ${max} characters or fewer.`;
  return coerceText(raw, max);
};

const readVisitDate = (raw, fieldErrors) => {
  const date = parseCalendarDate(raw);
  if (!date) {
    fieldErrors.visitDate = "Enter the visit date as YYYY-MM-DD, for example 2024-03-15.";
    return null;
  }
  if (date.getTime() > Date.now() || date.getTime() < EARLIEST_VISIT) {
    fieldErrors.visitDate = "The visit date must be a past date.";
    return null;
  }
  return date;
};

const readProviderRole = (raw, fieldErrors) => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "string" && STAFF_ROLES.includes(raw.trim().toLowerCase())) return raw.trim().toLowerCase();
  fieldErrors.providerRole = "Choose doctor, midwife, BHW or admin for the provider role.";
  return null;
};

const readSource = (raw, fieldErrors) => {
  if (raw === undefined || raw === null || raw === "") return MEDICAL_RECORD_SOURCES.HISTORICAL_MASTERLIST;
  if (ENCODABLE_SOURCES.includes(raw)) return raw;
  fieldErrors.source = "Choose historical record, walk-in, medical mission or manual entry.";
  return null;
};

const hasAnyMedicalValue = (value) =>
  ["assessment", "findings", "diagnosis", "recommendations", "notes"].some((key) => Boolean(value[key])) ||
  Object.keys(value.serviceDetails ?? {}).length > 0;

// Follow-up and next-dose dates are checked against the record's own visit
// day, so a 2024 paper record can carry a 2024 recheck date.
const readMedical = (serviceType, raw, fieldErrors, errors, visitDate) => {
  const result = validateMedicalRecordInput(serviceType, raw, {
    optionalKeys: OPTIONAL_FOR_ENCODED,
    visitDay: visitDate ? visitDate.toISOString().slice(0, 10) : null,
  });
  errors.push(...result.errors);
  if (result.ok && !hasAnyMedicalValue(result.value)) {
    fieldErrors.record = "Enter at least one medical detail from the record.";
  }
  return result.value;
};

const assertValid = (fieldErrors, errors) => {
  const messages = [...Object.values(fieldErrors), ...errors];
  if (messages.length === 0) return;
  const error = validationFailed(messages[0], messages);
  error.details = { ...(error.details ?? {}), fieldErrors };
  throw error;
};

// Fields staff may change after saving. Identity, service and source are fixed.
const readEditableFields = (body, serviceType) => {
  const fieldErrors = {};
  const errors = [];
  const completedAt = readVisitDate(body.visitDate, fieldErrors);
  const fields = {
    completedAt,
    providerName: textFor(body, "providerName", 120, fieldErrors, "Provider name"),
    providerRole: readProviderRole(body.providerRole, fieldErrors),
    visitReason: textFor(body, "visitReason", 500, fieldErrors, "Reason for visit"),
    ...readMedical(serviceType, body.record, fieldErrors, errors, completedAt),
  };
  return { fields, fieldErrors, errors };
};

const readNewRecord = (body = {}) => {
  const masterResidentId = typeof body.masterResidentId === "string" ? body.masterResidentId.trim() : "";
  const serviceType = typeof body.serviceType === "string" ? body.serviceType.trim() : "";
  const { fields, fieldErrors, errors } = readEditableFields(body, serviceType);

  if (!MASTER_ID.test(masterResidentId)) fieldErrors.masterResidentId = "Choose a resident from the master list.";
  const source = readSource(body.source, fieldErrors);
  assertValid(fieldErrors, errors);

  return {
    masterResidentId,
    serviceType,
    source,
    fields,
    requestKey: typeof body.requestKey === "string" && body.requestKey.trim() ? body.requestKey.trim().slice(0, 64) : null,
    confirmDuplicate: body.confirmDuplicate === true,
  };
};

const readRecordEdit = (body = {}, serviceType) => {
  const { fields, fieldErrors, errors } = readEditableFields(body, serviceType);
  const reason = textFor(body, "reason", 500, fieldErrors, "Reason for change");
  if (!reason && !fieldErrors.reason) fieldErrors.reason = "Say why this record is being changed.";
  assertValid(fieldErrors, errors);
  return { fields, reason };
};

module.exports = { readNewRecord, readRecordEdit };
