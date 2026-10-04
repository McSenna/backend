"use strict";

// Admin-only maintenance of the Barangay Master List. Every handler works on
// master list records only; none of them touches a user account.

const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");
const { createSystemLog } = require("../services/systemLogService");
const {
  listMasterResidents,
  getMasterResident,
  createMasterResident,
  updateMasterResident,
  setMasterResidentActive,
} = require("../services/masterList/masterResidentAdmin");
const { importMasterResidents } = require("../services/masterList/masterResidentImport");

const adminIdOf = (req) => req.user?.userId || req.user?._id;

// Audit entries name the record ID only, never the resident's personal details.
const logRecordAction = (req, action, description, metadata) =>
  createSystemLog({
    req,
    action,
    role: req.user?.role || "admin",
    description,
    resource: "MasterResident",
    resourceId: metadata.masterResidentId ?? "",
    metadata,
  });

exports.listMasterResidents = asyncHandler(async (req, res) => {
  const result = await listMasterResidents(req.query);
  return res.status(HTTP_STATUS.OK).json({ success: true, ...result });
});

exports.getMasterResident = asyncHandler(async (req, res) => {
  const record = await getMasterResident(req.params.id);
  return res.status(HTTP_STATUS.OK).json({ success: true, record });
});

exports.createMasterResident = asyncHandler(async (req, res) => {
  const record = await createMasterResident(req.body ?? {}, adminIdOf(req));
  await logRecordAction(req, "MASTER_RESIDENT_CREATED", `Admin added master list record ${record.masterResidentId}`, {
    masterResidentId: record.masterResidentId,
  });
  return res
    .status(HTTP_STATUS.CREATED)
    .json({ success: true, message: "Master list record added.", record });
});

exports.updateMasterResident = asyncHandler(async (req, res) => {
  const { record, changedFields } = await updateMasterResident(req.params.id, req.body ?? {}, adminIdOf(req));
  if (changedFields.length > 0) {
    await logRecordAction(req, "MASTER_RESIDENT_UPDATED", `Admin edited master list record ${record.masterResidentId}`, {
      masterResidentId: record.masterResidentId,
      fields: changedFields,
    });
  }
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: changedFields.length > 0 ? "Master list record updated." : "No changes to save.",
    record,
  });
});

exports.setMasterResidentStatus = asyncHandler(async (req, res) => {
  const { record, changed } = await setMasterResidentActive(req.params.id, req.body?.active, adminIdOf(req));
  if (changed) {
    const action = record.isActive ? "MASTER_RESIDENT_REACTIVATED" : "MASTER_RESIDENT_DEACTIVATED";
    const verb = record.isActive ? "reactivated" : "deactivated";
    await logRecordAction(req, action, `Admin ${verb} master list record ${record.masterResidentId}`, {
      masterResidentId: record.masterResidentId,
    });
  }
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: record.isActive ? "Master list record is active." : "Master list record deactivated.",
    record,
  });
});

exports.importMasterResidents = asyncHandler(async (req, res) => {
  const { imported } = await importMasterResidents(req.body?.records, adminIdOf(req));
  await logRecordAction(req, "MASTER_RESIDENTS_IMPORTED", `Admin imported ${imported} master list records`, {
    count: imported,
  });
  return res
    .status(HTTP_STATUS.CREATED)
    .json({ success: true, message: `${imported} master list records imported.`, imported });
});
