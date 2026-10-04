"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const {
  submitResidentRegistration,
} = require("../../services/auth/residentRegistrationService");

const PENDING_MESSAGE =
  "Your registration has been successfully submitted. Your account is currently pending verification by the Barangay Administrator.";

const VERIFIED_MESSAGE =
  "Your registration is complete and your account is verified. You can now log in to MaslogCare.";

exports.register = asyncHandler(async (req, res) => {
  const { user, verification, idTypeName, verified, masterListOutcome } =
    await submitResidentRegistration(req.body);
  const status = verified ? "approved" : "pending";

  await createSystemLog({
    req,
    action: "RESIDENT_REGISTRATION_SUBMITTED",
    role: "resident",
    user,
    description: verified
      ? `Resident ${user.fullname} registered and was verified automatically against the Barangay Master List`
      : `Resident ${user.fullname} submitted registration for verification`,
    resource: "User",
    resourceId: String(user._id),
    metadata: {
      email: user.email,
      idType: idTypeName,
      verificationId: String(verification._id),
      status,
      verificationMethod: verification.verificationMethod,
      masterListOutcome,
      ...(verified ? { masterResidentId: user.masterResidentId } : {}),
    },
  });

  // The response is the same for every master list outcome that ends in
  // review, so it never tells the caller whether a record exists.
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    status,
    message: verified ? VERIFIED_MESSAGE : PENDING_MESSAGE,
    email: user.email,
    userId: String(user._id),
  });
});
