"use strict";

const { getCategoryKeysForRole } = require("../../config/consultationCategories");

/**
 * `notes` is declared in config/medicalRecordFields/sharedFields.js as
 * "Anything else worth recording. Not shown to the resident." Strip it from any
 * payload the resident receives so the field stays private to the care team.
 */
const STAFF_ONLY_FIELDS = Object.freeze(["notes"]);

// Audit and bookkeeping fields on encoded records. Staff read them through the
// Medical Records Masterlist; no resident payload carries them.
const INTERNAL_FIELDS = Object.freeze([
  "revisions",
  "createdBy",
  "createdByRole",
  "updatedBy",
  "updatedByRole",
  "requestKey",
  "duplicateAcknowledged",
  "masterResidentId",
]);

const idOf = (value) => String(value?._id ?? value ?? "");

const describeAccess = (record, user) => {
  const role = String(user?.role || "").trim().toLowerCase();
  const userId = String(user?.userId ?? "");

  return {
    role,
    isOwner: idOf(record.resident) === userId,
    isAuthor: idOf(record.provider) === userId || (Boolean(record.createdBy) && idOf(record.createdBy) === userId),
    ownsService: getCategoryKeysForRole(role).includes(record.serviceType),
  };
};

const forResident = (record) => {
  const safe = { ...record };
  for (const field of [...STAFF_ONLY_FIELDS, ...INTERNAL_FIELDS]) delete safe[field];
  return safe;
};

const withoutInternals = (record) => {
  const safe = { ...record };
  delete safe.requestKey;
  return safe;
};

const redactForViewer = (record, access) =>
  access.isAuthor || access.ownsService ? withoutInternals(record) : forResident(record);

module.exports = { STAFF_ONLY_FIELDS, describeAccess, forResident, redactForViewer };
