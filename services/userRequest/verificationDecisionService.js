"use strict";

const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const { notFound, conflict, badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { VERIFICATION_METHODS } = require("../../config/masterList");
const { isLinkCollision, findLinkableRecordId } = require("../masterList/masterLink");
const { assertLinkable } = require("./accountMasterLinkService");

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

// Saves the approved account, linking the master record when possible. If
// another account took the record in the meantime, approval still goes ahead
// without the link.
const saveApprovedUser = async (user, masterResidentId) => {
  if (!masterResidentId) {
    await user.save();
    return null;
  }

  user.masterResidentId = masterResidentId;
  try {
    await user.save();
    return masterResidentId;
  } catch (error) {
    if (!isLinkCollision(error)) throw error;
    user.masterResidentId = undefined;
    await user.save();
    return null;
  }
};

// The admin may pick one of the records the sign-up check named (a string),
// keep the account unlinked (null), or leave it to the clean-match rule
// (undefined). A pick is checked before anything is written.
const resolveLinkChoice = async ({ choice, verification, user }) => {
  if (choice === undefined) {
    return findLinkableRecordId({ masterListCheck: verification.masterListCheck, userId: user._id });
  }
  if (choice === null || choice === "") return null;

  const candidateIds = verification.masterListCheck?.candidateIds ?? [];
  if (typeof choice !== "string" || !candidateIds.includes(choice.trim())) {
    throw badRequest("Choose one of the master list records shown for this request.", ERROR_CODES.VALIDATION_ERROR);
  }
  await assertLinkable(choice.trim(), user._id);
  return choice.trim();
};

const approve = async ({ id, adminId, masterResidentId }) => {
  const { verification, user } = await loadPendingVerification(id);
  const now = new Date();
  const linkableId = await resolveLinkChoice({ choice: masterResidentId, verification, user });

  verification.verificationStatus = "approved";
  verification.verificationMethod = VERIFICATION_METHODS.ADMIN_REVIEW;
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
  user.verificationMethod = VERIFICATION_METHODS.ADMIN_REVIEW;
  const linkedMasterResidentId = await saveApprovedUser(user, linkableId);

  return { verification, user, now, linkedMasterResidentId };
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
  verification.verificationMethod = VERIFICATION_METHODS.ADMIN_REVIEW;
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
  user.verificationMethod = VERIFICATION_METHODS.ADMIN_REVIEW;
  await user.save();

  return { verification, user, now, trimmedReason, trimmedRemarks };
};

module.exports = { approve, reject };
