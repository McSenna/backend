"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const {
  submitResidentRegistration,
} = require("../../services/auth/residentRegistrationService");

exports.register = asyncHandler(async (req, res) => {
  const { user, verification, idTypeName } = await submitResidentRegistration(req.body);

  await createSystemLog({
    req,
    action: "RESIDENT_REGISTRATION_SUBMITTED",
    role: "resident",
    user,
    description: `Resident ${user.fullname} submitted registration for verification`,
    resource: "User",
    resourceId: String(user._id),
    metadata: {
      email: user.email,
      idType: idTypeName,
      verificationId: String(verification._id),
      status: "pending",
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    status: "pending",
    message:
      "Your registration has been successfully submitted. Your account is currently pending verification by the Barangay Administrator.",
    email: user.email,
    userId: String(user._id),
  });
});
