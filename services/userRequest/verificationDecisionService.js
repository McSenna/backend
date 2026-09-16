"use strict";

const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const { notFound, conflict, badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");

const assertValidVerificationId = (id) => {
  if (!isValidObjectId(id)) {
    throw badRequest("A valid verification ID is required.", ERROR_CODES.VALIDATION_ERROR);
  }
};

const loadPendingVerification = async (id) => {
  assertValidVerificationId(id);

  const verification = await ResidentVerification.findById(id);
  if (!verification) {
    throw notFound("Verification request not found.", ERROR_CODES.NOT_FOUND);
  }
  if (verification.verificationStatus !== "pending") {
    throw conflict(
      `This request has already been ${verification.verificationStatus}.`,
      ERROR_CODES.REQUEST_ALREADY_PROCESSED
    );
  }

  const user = await User.findById(verification.user);
  if (!user) {
    throw notFound("Resident user account not found.", ERROR_CODES.USER_NOT_FOUND);
  }

  return { verification, user };
};

const approve = async ({ id, adminId }) => {
  const { verification, user } = await loadPendingVerification(id);
  const now = new Date();

  verification.verificationStatus = "approved";
  verification.verifiedBy = adminId;
  verification.verifiedAt = now;
  verification.rejectionReason = "";
  verification.rejectionRemarks = "";
  await verification.save();

  user.status = "approved";
  user.verified = true;
  user.approved_by = adminId;
  user.approved_at = now;
  user.rejected_by = null;
  user.rejected_at = null;
  user.rejection_reason = "";
  user.rejection_remarks = "";
  await user.save();

  return { verification, user, now };
};

const reject = async ({ id, adminId, reason, remarks }) => {
  assertValidVerificationId(id);

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw badRequest("A reason for rejection is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  const trimmedReason = reason.trim();
  const trimmedRemarks = String(remarks || "").trim();

  if (trimmedReason === "Other" && !trimmedRemarks) {
    throw badRequest(
      "Additional remarks are required when 'Other' is selected.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const { verification, user } = await loadPendingVerification(id);
  const now = new Date();

  verification.verificationStatus = "rejected";
  verification.verifiedBy = adminId;
  verification.verifiedAt = now;
  verification.rejectionReason = trimmedReason;
  verification.rejectionRemarks = trimmedRemarks;
  await verification.save();

  user.status = "rejected";
  user.rejected_by = adminId;
  user.rejected_at = now;
  user.rejection_reason = trimmedReason;
  user.rejection_remarks = trimmedRemarks;
  await user.save();

  return { verification, user, now, trimmedReason, trimmedRemarks };
};

module.exports = { approve, reject };
