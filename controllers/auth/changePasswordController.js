"use strict";

const User = require("../../models/User");
const asyncHandler = require("../../utils/asyncHandler");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { sendPasswordChangedEmail } = require("../../services/mailer");
const { validatePasswordStrength } = require("../../services/passwordReset/resetPolicy");

exports.changePassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = req.body?.confirmPassword ? String(req.body.confirmPassword) : null;

  if (!currentPassword) {
    throw badRequest("Current password is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  if (!newPassword) {
    throw badRequest("New password is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  if (confirmPassword !== null && confirmPassword !== newPassword) {
    throw badRequest("Passwords do not match.", ERROR_CODES.VALIDATION_ERROR);
  }

  if (currentPassword === newPassword) {
    throw badRequest(
      "Your new password must be different from your current password.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const problems = validatePasswordStrength(newPassword);
  if (problems.length) {
    throw badRequest(problems.join(" "), ERROR_CODES.VALIDATION_ERROR);
  }

  const user = await User.findById(req.user.userId).select("+password");
  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw badRequest("Current password is incorrect.", ERROR_CODES.INVALID_CREDENTIALS);
  }

  user.password = newPassword;
  await user.save();

  const changedAt = new Date();

  void createSystemLog({
    req,
    action: "PASSWORD_CHANGED",
    user: { _id: user._id, role: user.role },
    role: user.role,
    description: `${user.fullname} changed their password`,
    resource: "User",
    resourceId: String(user._id),
    metadata: { email: user.email, changedAt: changedAt.toISOString() },
  });

  try {
    await sendPasswordChangedEmail({
      email: user.email,
      fullname: user.fullname,
      changedAt,
    });
  } catch {
    // Non-fatal email notification failure
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Password changed successfully.",
  });
});
