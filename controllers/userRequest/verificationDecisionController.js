"use strict";

const Notification = require("../../models/Notification");
const asyncHandler = require("../../utils/asyncHandler");
const logger = require("../../utils/logger");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { approve, reject } = require("../../services/userRequest/verificationDecisionService");

const adminIdOf = (req) => req.user?.userId || req.user?._id;

const notifyResident = async (notification) => {
  try {
    await Notification.create(notification);
  } catch (err) {
    logger.error("Failed to create resident verification notification", {
      errorName: err?.name,
      errorMessage: err?.message,
    });
  }
};

exports.approveUserRequest = asyncHandler(async (req, res) => {
  const { verification, user, now } = await approve({
    id: req.params.id,
    adminId: adminIdOf(req),
  });

  await createSystemLog({
    req,
    action: "USER_APPROVED",
    role: req.user?.role || "admin",
    description: `Admin approved resident registration for ${user.fullname}`,
    resource: "User",
    resourceId: String(user._id),
    metadata: {
      targetUserId: String(user._id),
      targetEmail: user.email,
      idType: verification.idType,
      verifiedAt: now,
    },
  });

  await notifyResident({
    recipient: user._id,
    type: "resident_approved",
    title: "Account Approved",
    body: "Your MaslogCare registration has been approved. You may now log in to your account.",
    tone: "success",
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Resident registration for ${user.fullname} has been approved.`,
    verification: verification.toAdminSummary(),
  });
});

exports.rejectUserRequest = asyncHandler(async (req, res) => {
  const { verification, user, now, trimmedReason, trimmedRemarks } = await reject({
    id: req.params.id,
    adminId: adminIdOf(req),
    reason: req.body.reason,
    remarks: req.body.remarks,
  });

  await createSystemLog({
    req,
    action: "USER_REJECTED",
    role: req.user?.role || "admin",
    description: `Admin rejected resident registration for ${user.fullname}: ${trimmedReason}`,
    resource: "User",
    resourceId: String(user._id),
    metadata: {
      targetUserId: String(user._id),
      targetEmail: user.email,
      reason: trimmedReason,
      remarks: trimmedRemarks,
      rejectedAt: now,
    },
  });

  await notifyResident({
    recipient: user._id,
    type: "resident_rejected",
    title: "Registration Requires Attention",
    body: `Your registration could not be approved. Reason: ${trimmedReason}. Please contact the Barangay Health Center or Barangay Administrator for assistance.`,
    tone: "warning",
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Resident registration for ${user.fullname} has been rejected.`,
    verification: verification.toAdminSummary(),
  });
});
