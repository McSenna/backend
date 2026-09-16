"use strict";

const PasswordReset = require("../../models/PasswordReset");
const asyncHandler = require("../../utils/asyncHandler");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const {
  MAX_VERIFY_ATTEMPTS,
  INVALID_CODE_MESSAGE,
  normalizeEmail,
  isSixDigitCode,
  readCode,
} = require("../../services/passwordReset/resetPolicy");

exports.verifyResetCode = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = readCode(req.body);

  if (!email || !isSixDigitCode(code)) {
    throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.VALIDATION_ERROR);
  }

  const request = await PasswordReset.findOne({ email }).select("+otp");
  if (!request || request.isExpired()) {
    throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.OTP_EXPIRED);
  }

  if (await request.matchesOtp(code)) {
    request.verifiedAt = new Date();
    request.attempts = 0;
    await request.save();

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "Verification successful. You can now set a new password.",
    });
  }

  request.attempts += 1;

  if (request.attempts >= MAX_VERIFY_ATTEMPTS) {
    await PasswordReset.deleteOne({ _id: request._id });
    throw badRequest(
      "Too many incorrect attempts. Please request a new verification code.",
      ERROR_CODES.OTP_MAX_ATTEMPTS
    );
  }

  await request.save();
  throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.OTP_INVALID);
});
