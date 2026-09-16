"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const {
  sendEmailVerification,
} = require("../../services/auth/emailVerificationService");
const {
  confirmEmailVerification,
} = require("../../services/auth/emailVerificationConfirm");

exports.sendEmailVerificationCode = asyncHandler(async (req, res) => {
  const result = await sendEmailVerification(req.body?.email);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "We sent a verification code to your email address.",
    expiresInMinutes: result.expiresInMinutes,
    resendAfterSeconds: result.resendAfterSeconds,
  });
});

exports.verifyEmailVerificationCode = asyncHandler(async (req, res) => {
  const result = await confirmEmailVerification({
    email: req.body?.email,
    otp: req.body?.otp,
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Your email address has been verified.",
    email: result.email,
    verificationToken: result.verificationToken,
    expiresInMinutes: result.expiresInMinutes,
  });
});
