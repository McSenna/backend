"use strict";

// Medical Records Masterlist for staff. Every handler narrows to the services
// the signed-in role owns (services/medicalRecord/masterlistQuery.js), and
// audit entries carry record IDs and field names only, never medical values
// or the resident's name.

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { searchIdentities } = require("../../services/masterList/medicalIdentityLookup");
const {
  listMasterlistRecords,
  masterlistSummary,
  getMasterlistRecord,
} = require("../../services/medicalRecord/masterlistReadService");
const {
  createEncodedRecord,
  updateEncodedRecord,
} = require("../../services/medicalRecord/masterlistRecordService");
const { normalizeRole } = require("../../services/medicalRecord/serviceOwnership");

const logRecordAction = (req, action, description, recordId, metadata = {}) =>
  createSystemLog({
    req,
    action,
    role: normalizeRole(req.user),
    description,
    resource: "MedicalRecord",
    resourceId: recordId,
    metadata,
  });

exports.searchRecords = asyncHandler(async (req, res) => {
  const result = await listMasterlistRecords(req.user, req.body ?? {});
  return res.status(HTTP_STATUS.OK).json({ success: true, ...result });
});

exports.getSummary = asyncHandler(async (req, res) => {
  const summary = await masterlistSummary(req.user);
  return res.status(HTTP_STATUS.OK).json({ success: true, summary });
});

exports.searchIdentities = asyncHandler(async (req, res) => {
  const identities = await searchIdentities(req.body?.query);
  return res.status(HTTP_STATUS.OK).json({ success: true, identities });
});

exports.getRecord = asyncHandler(async (req, res) => {
  const detail = await getMasterlistRecord(req.user, req.params.id);
  void logRecordAction(req, "RECORD_VIEWED", "Medical record viewed from the masterlist", detail._id, {
    serviceType: detail.serviceType,
    source: detail.source,
  });
  return res.status(HTTP_STATUS.OK).json({ success: true, detail });
});

exports.createRecord = asyncHandler(async (req, res) => {
  const result = await createEncodedRecord(req.user, req.body ?? {});
  const detail = await getMasterlistRecord(req.user, result.recordId);

  if (result.created) {
    const metadata = { serviceType: detail.serviceType, source: detail.source, masterResidentId: detail.resident.masterResidentId };
    await logRecordAction(req, "MEDICAL_RECORD_CREATED", "Medical record encoded", result.recordId, metadata);
    if (result.duplicateConfirmed) {
      await logRecordAction(
        req,
        "MEDICAL_RECORD_DUPLICATE_CONFIRMED",
        "Medical record saved after a possible-duplicate warning",
        result.recordId,
        metadata
      );
    }
  }

  return res.status(result.created ? HTTP_STATUS.CREATED : HTTP_STATUS.OK).json({
    success: true,
    message: result.created ? "Medical record saved." : "This medical record was already saved.",
    detail,
  });
});

exports.updateRecord = asyncHandler(async (req, res) => {
  const { recordId, changedFields } = await updateEncodedRecord(req.user, req.params.id, req.body ?? {});
  const detail = await getMasterlistRecord(req.user, recordId);

  if (changedFields.length > 0) {
    await logRecordAction(req, "MEDICAL_RECORD_UPDATED", "Medical record edited", recordId, {
      serviceType: detail.serviceType,
      source: detail.source,
      fields: changedFields,
    });
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: changedFields.length > 0 ? "Medical record updated." : "No changes to save.",
    detail,
  });
});
