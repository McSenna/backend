"use strict";

// Admin link and unlink between a resident account and its Barangay Master
// List record. The audit entry keeps the record IDs and the admin's reason so
// a wrong link can be traced and reversed.

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { linkAccount, unlinkAccount } = require("../../services/userRequest/accountMasterLinkService");

const logLinkChange = (req, action, description, user, metadata) =>
  createSystemLog({
    req,
    action,
    role: req.user?.role || "admin",
    description,
    resource: "User",
    resourceId: String(user._id),
    metadata: { targetUserId: String(user._id), ...metadata },
  });

exports.linkMasterRecord = asyncHandler(async (req, res) => {
  const { user, masterResidentId, reason } = await linkAccount({
    userId: req.params.id,
    masterResidentId: req.body?.masterResidentId,
    reason: req.body?.reason,
  });
  await logLinkChange(req, "ACCOUNT_MASTER_LINKED", "Admin linked an account to a master list record", user, {
    masterResidentId,
    reason,
  });
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Account linked to the master list record.",
    masterResidentId,
  });
});

exports.unlinkMasterRecord = asyncHandler(async (req, res) => {
  const { user, previousMasterResidentId, reason } = await unlinkAccount({
    userId: req.params.id,
    reason: req.body?.reason,
  });
  await logLinkChange(req, "ACCOUNT_MASTER_UNLINKED", "Admin unlinked an account from its master list record", user, {
    previousMasterResidentId,
    reason,
  });
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Account unlinked. Its encoded medical records are kept and no longer shown to this account.",
    masterResidentId: null,
  });
});
