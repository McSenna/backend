"use strict";

// Writes encoded medical records: paper records from before MaslogCare,
// walk-ins and mission visits. A record is tied to a master list identity, so
// it exists whether or not that resident has an account yet. Records are never
// deleted here; edits keep the earlier values as a revision.

const MedicalRecord = require("../../models/MedicalRecord");
const { findIdentity } = require("../masterList/medicalIdentityLookup");
const { badRequest, conflict, forbidden } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isAppointmentSource } = require("../../config/medicalRecordSources");
const { readNewRecord, readRecordEdit } = require("./masterlistPayload");
const { findPossibleDuplicates, possibleDuplicateError } = require("./duplicateCheck");
const { assertMayEncode, normalizeRole } = require("./serviceOwnership");
const { canEdit } = require("./masterlistPresenter");
const { loadScopedRecord } = require("./masterlistReadService");

const actorOf = (user) => ({ userId: user.userId, role: normalizeRole(user) });

const findReplay = (userId, requestKey) =>
  requestKey ? MedicalRecord.findOne({ createdBy: userId, requestKey }).select("_id").lean() : null;

const assertUsableIdentity = async (masterResidentId, visitDate) => {
  const identity = await findIdentity(masterResidentId);
  if (!identity || !identity.isActive) {
    throw badRequest("Choose an active resident from the master list.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (identity.dateOfBirth && visitDate.toISOString().slice(0, 10) < identity.dateOfBirth) {
    throw badRequest("The visit date is before this resident's birth date.", ERROR_CODES.VALIDATION_ERROR);
  }
  return identity;
};

const isRequestKeyCollision = (error) => error?.code === 11000 && Boolean(error?.keyPattern?.requestKey);

// Returns { recordId, created, duplicateConfirmed }. A retry with the same
// request key returns the first record instead of saving a second one.
const createEncodedRecord = async (user, body = {}) => {
  const actor = actorOf(user);
  assertMayEncode(user, typeof body.serviceType === "string" ? body.serviceType.trim() : "");
  const input = readNewRecord(body);

  const replay = await findReplay(actor.userId, input.requestKey);
  if (replay) return { recordId: String(replay._id), created: false, duplicateConfirmed: false };

  await assertUsableIdentity(input.masterResidentId, input.fields.completedAt);

  const duplicates = await findPossibleDuplicates({
    masterResidentId: input.masterResidentId,
    serviceType: input.serviceType,
    visitDate: input.fields.completedAt,
  });
  if (duplicates.length > 0 && !input.confirmDuplicate) throw possibleDuplicateError(duplicates);

  try {
    const record = await MedicalRecord.create({
      ...input.fields,
      masterResidentId: input.masterResidentId,
      serviceType: input.serviceType,
      source: input.source,
      createdBy: actor.userId,
      createdByRole: actor.role,
      updatedBy: actor.userId,
      updatedByRole: actor.role,
      duplicateAcknowledged: duplicates.length > 0,
      requestKey: input.requestKey,
    });
    return { recordId: String(record._id), created: true, duplicateConfirmed: duplicates.length > 0 };
  } catch (error) {
    if (!isRequestKeyCollision(error)) throw error;
    const first = await findReplay(actor.userId, input.requestKey);
    return { recordId: String(first._id), created: false, duplicateConfirmed: false };
  }
};

const EDITABLE_TOP_LEVEL = Object.freeze([
  "completedAt",
  "providerName",
  "providerRole",
  "visitReason",
  "assessment",
  "findings",
  "diagnosis",
  "recommendations",
  "notes",
  "followUpRequired",
  "followUpDate",
]);

const comparable = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const same = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

const changesBetween = (record, fields) => {
  const topLevel = EDITABLE_TOP_LEVEL.filter((key) => !same(record[key], fields[key])).map((key) => ({
    field: key,
    previous: comparable(record[key]),
  }));
  const before = record.serviceDetails ?? {};
  const after = fields.serviceDetails ?? {};
  const detailKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const details = detailKeys
    .filter((key) => !same(before[key], after[key]))
    .map((key) => ({ field: `serviceDetails.${key}`, previous: comparable(before[key]) }));
  return [...topLevel, ...details];
};

// Returns { recordId, changedFields }. Nothing is written when nothing changed.
const updateEncodedRecord = async (user, id, body = {}) => {
  const actor = actorOf(user);
  const scoped = await loadScopedRecord(user, id);
  if (isAppointmentSource(scoped.source)) {
    throw conflict("Records from completed appointments cannot be edited here.", ERROR_CODES.CONFLICT);
  }
  if (!canEdit(scoped, user)) {
    throw forbidden("Only an admin or the staff member who encoded this record can edit it.");
  }

  const { fields, reason } = readRecordEdit(body, scoped.serviceType);
  await assertUsableIdentity(scoped.masterResidentId, fields.completedAt);

  const record = await MedicalRecord.findById(scoped._id);
  const changes = changesBetween(record.toObject(), fields);
  if (changes.length === 0) return { recordId: String(record._id), changedFields: [] };

  record.set(fields);
  record.updatedBy = actor.userId;
  record.updatedByRole = actor.role;
  record.revisions.push({ editedBy: actor.userId, editedByRole: actor.role, editedAt: new Date(), reason, changes });
  await record.save();
  return { recordId: String(record._id), changedFields: changes.map((change) => change.field) };
};

module.exports = { createEncodedRecord, updateEncodedRecord };
