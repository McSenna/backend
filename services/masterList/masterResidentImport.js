"use strict";

// Bulk import of official records supplied by the barangay. All or nothing:
// every row is checked first, and one bad row means no record is added. Rows
// only ever become master list records; no account is created or touched.

const MasterResident = require("../../models/MasterResident");
const { badRequest, conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { buildNewRecord } = require("./masterResidentPayload");

const MAX_IMPORT_ROWS = 500;

const duplicateIdError = () =>
  conflict("A master list record with this ID already exists.", ERROR_CODES.DUPLICATE_RESOURCE);

const rowErrorsOf = async (docs, built) => {
  const ids = docs.map((doc) => doc.masterResidentId);
  const existing = new Set(
    (await MasterResident.find({ masterResidentId: { $in: ids } }).select("masterResidentId").lean()).map(
      (record) => record.masterResidentId
    )
  );
  const seen = new Set();

  return built.flatMap(({ doc, fieldErrors }, index) => {
    const errors = { ...fieldErrors };
    if (existing.has(doc.masterResidentId) || seen.has(doc.masterResidentId)) {
      errors.masterResidentId = "This master resident ID is already on the list";
    }
    seen.add(doc.masterResidentId);
    return Object.keys(errors).length > 0 ? [{ row: index + 1, fieldErrors: errors }] : [];
  });
};

const importMasterResidents = async (rows, adminId) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest("Send the records to import as a non-empty list.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw badRequest(`Import at most ${MAX_IMPORT_ROWS} records at a time.`, ERROR_CODES.VALIDATION_ERROR);
  }

  const built = [];
  for (const row of rows) {
    built.push(await buildNewRecord(row && typeof row === "object" ? row : {}, adminId));
  }
  const docs = built.map((entry) => entry.doc);
  const rowErrors = await rowErrorsOf(docs, built);

  if (rowErrors.length > 0) {
    const error = badRequest(
      `${rowErrors.length} of ${rows.length} records need fixing. Nothing was imported.`,
      ERROR_CODES.VALIDATION_ERROR
    );
    error.details = { rowErrors };
    throw error;
  }

  try {
    await MasterResident.insertMany(docs, { ordered: true });
  } catch (error) {
    if (error?.code === 11000) throw duplicateIdError();
    throw error;
  }
  return { imported: docs.length };
};

module.exports = { MAX_IMPORT_ROWS, duplicateIdError, importMasterResidents };
