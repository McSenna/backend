"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const logger = require("../../utils/logger");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { issueResetCode } = require("../../services/passwordReset/resetCodeService");
const {
  OTP_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  NEUTRAL_SEND_MESSAGE,
  normalizeEmail,
  isValidEmail,
} = require("../../services/passwordReset/resetPolicy");

exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!email || !isValidEmail(email)) {
    throw badRequest("Enter a valid email address.", ERROR_CODES.VALIDATION_ERROR);
  }

  try {
    await issueResetCode(email, req);
  } catch (error) {
    if (error?.statusCode === HTTP_STATUS.TOO_MANY_REQUESTS) throw error;
    logger.error("Password reset request failed", { errorName: error?.name });
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: NEUTRAL_SEND_MESSAGE,
    expiresInMinutes: OTP_TTL_MINUTES,
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
  });
});
