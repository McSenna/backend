"use strict";

const User = require("../../models/User");
const PasswordReset = require("../../models/PasswordReset");
const asyncHandler = require("../../utils/asyncHandler");
const logger = require("../../utils/logger");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { sendPasswordChangedEmail } = require("../../services/mailer");
const {
  maskEmailAddress,
} = require("../../services/mailer/templates/passwordChangedTemplate");
const { createSystemLog } = require("../../services/systemLogService");
const {
  INVALID_CODE_MESSAGE,
  normalizeEmail,
  isSixDigitCode,
  readCode,
  validatePasswordStrength,
} = require("../../services/passwordReset/resetPolicy");

const loadVerifiedRequest = async (email, code) => {
  const request = await PasswordReset.findOne({ email }).select("+otp");
  if (!request || request.isExpired() || !request.verifiedAt) {
    throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.OTP_EXPIRED);
  }
  if (!(await request.matchesOtp(code))) {
    throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.OTP_INVALID);
  }
  return request;
};

const notifyPasswordChanged = async (user, changedAt) => {
  try {
    await sendPasswordChangedEmail({ email: user.email, fullname: user.fullname, changedAt });
    return true;
  } catch (error) {
    logger.error("Password-changed notification failed to send", {
      errorName: error?.name,
      userId: String(user._id),
    });
    return false;
  }
};

exports.resetPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = readCode(req.body);
  const newPassword = String(req.body?.newPassword || "");

  if (!email || !isSixDigitCode(code)) {
    throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.VALIDATION_ERROR);
  }

  const problems = validatePasswordStrength(newPassword);
  if (problems.length) {
    throw badRequest(problems.join(" "), ERROR_CODES.VALIDATION_ERROR);
  }

  const request = await loadVerifiedRequest(email, code);

  const user = await User.findById(request.user).select("_id email fullname role");
  if (!user) {
    throw badRequest(INVALID_CODE_MESSAGE, ERROR_CODES.OTP_EXPIRED);
  }

  user.password = newPassword;
  await user.save();

  const changedAt = new Date();

  await PasswordReset.deleteOne({ _id: request._id });

  void createSystemLog({
    req,
    action: "PASSWORD_CHANGED",
    user: { _id: user._id, role: user.role },
    role: user.role,
    description: "Password changed through account recovery",
    resource: "Auth",
    resourceId: String(user._id),
    metadata: { email: user.email, changedAt: changedAt.toISOString() },
  });

  const notificationSent = await notifyPasswordChanged(user, changedAt);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Your password has been reset. You can now sign in with your new password.",
    changedAt: changedAt.toISOString(),
    notification: { sent: notificationSent, maskedEmail: maskEmailAddress(user.email) },
  });
});
