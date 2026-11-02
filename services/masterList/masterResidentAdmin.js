"use strict";

// The only code that writes Barangay Master List records. It never reads
// account fields beyond a "has a linked account" flag and never writes to the
// users collection, so maintaining the list cannot create, change or remove an
// account. Deactivation and soft deletion retain the official document, so
// linked account and clinical history references never dangle.

const MasterResident = require("../../models/MasterResident");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { linkedIdsAmong, toRow } = require("./masterResidentRows");
const {
  OFFICIAL_FIELDS,
  readOfficialFields,
  buildNewRecord,
  validateRecord,
  assertNoFieldErrors,
} = require("./masterResidentPayload");

const { translateDuplicateError } = require("./residentIdentity");
const { assertIdentityEnforcement } = require("./residentIdentityReadiness");
const { buildMasterResidentFilter, readMasterResidentSort } = require("./masterResidentQuery");

const listMasterResidents = async ({ search = "", status = "active", role = "all", civilStatus = "all", purok = "all", sort = "name_asc", page, limit } = {}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const filter = buildMasterResidentFilter({ search, status, role, civilStatus, purok });
  const ordering = readMasterResidentSort(sort);

  const [records, total, active, inactive] = await Promise.all([
    MasterResident.find(filter)
      .sort(ordering)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    MasterResident.countDocuments(filter),
    MasterResident.countDocuments({ isActive: true, deletedAt: null }),
    MasterResident.countDocuments({ isActive: false, deletedAt: null }),
  ]);

  const linked = await linkedIdsAmong(records);
  return {
    records: records.map((record) => toRow(record, linked)),
    counts: { active, inactive, total: active + inactive },
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
  };
};

const loadRecord = async (id) => {
  if (!isValidObjectId(id)) {
    throw badRequest("A valid master list record ID is required.", ERROR_CODES.VALIDATION_ERROR);
  }
  const record = await MasterResident.findById(id);
  if (!record || record.deletedAt) throw notFound("Master list record not found.", ERROR_CODES.NOT_FOUND);
  // Blank legacy classifications have always meant Resident.
  if (!record.role) record.role = "resident";
  return record;
};

const presentOne = async (record) => toRow(record.toObject(), await linkedIdsAmong([record]));

const getMasterResident = async (id) => presentOne(await loadRecord(id));

const saveRecord = async (record) => {
  await assertIdentityEnforcement();
  try {
    await record.save();
  } catch (error) {
    throw translateDuplicateError(error);
  }
};

const createMasterResident = async (body, adminId) => {
  const { doc, fieldErrors } = await buildNewRecord(body, adminId);
  assertNoFieldErrors(fieldErrors);
  await saveRecord(doc);
  return presentOne(doc);
};

// The record ID and status are never edited here.
const updateMasterResident = async (id, body, adminId) => {
  const record = await loadRecord(id);
  const { fields, fieldErrors } = readOfficialFields(body);
  record.set(fields);
  const changedFields = OFFICIAL_FIELDS.filter((field) => record.isModified(field));
  record.updatedBy = adminId;

  assertNoFieldErrors({ ...(await validateRecord(record)), ...fieldErrors });
  if (changedFields.length > 0) await saveRecord(record);
  return { record: await presentOne(record), changedFields };
};

const setMasterResidentActive = async (id, active, adminId) => {
  if (typeof active !== "boolean") {
    throw badRequest("Say whether the record should be active (true or false).", ERROR_CODES.VALIDATION_ERROR);
  }
  const record = await loadRecord(id);
  const changed = record.isActive !== active;

  if (changed) {
    record.isActive = active;
    record.deactivatedAt = active ? null : new Date();
    record.deactivatedBy = active ? null : adminId;
    record.updatedBy = adminId;
    await saveRecord(record);
  }
  return { record: await presentOne(record), changed };
};

// Atomic and idempotent: simultaneous confirmations produce one change and audit entry.
// Never hard-delete a registry identity or cascade into accounts or medical records.
const deleteMasterResident = async (id, adminId) => {
  if (!isValidObjectId(id)) {
    throw badRequest("A valid master list record ID is required.", ERROR_CODES.VALIDATION_ERROR);
  }
  const now = new Date();
  const record = await MasterResident.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: now, deletedBy: adminId, isActive: false, updatedBy: adminId } },
    { returnDocument: "after" }
  );
  if (record) return { masterResidentId: record.masterResidentId, changed: true };
  const retained = await MasterResident.findById(id).select("masterResidentId deletedAt").lean();
  if (!retained) throw notFound("Master list record not found.", ERROR_CODES.NOT_FOUND);
  return { masterResidentId: retained.masterResidentId, changed: false };
};

module.exports = {
  deleteMasterResident,
  listMasterResidents,
  getMasterResident,
  createMasterResident,
  updateMasterResident,
  setMasterResidentActive,
};
