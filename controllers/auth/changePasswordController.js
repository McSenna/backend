"use strict";

const User = require("../../models/User");
const asyncHandler = require("../../utils/asyncHandler");
const { badRequest, notFound } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { sendPasswordChangedEmail } = require("../../services/mailer");
const { validatePasswordStrength } = require("../../services/passwordReset/resetPolicy");
const { issueSession } = require("../../services/sessionService");
const { adoptSessionToken, disconnectOtherSessions } = require("../../realtime/socketServer");
const logger = require("../../utils/logger");

// `fieldErrors` tells the app which input to mark; the message stays for app
// versions that only read it.
const fieldError = (field, message, code = ERROR_CODES.VALIDATION_ERROR) =>
  badRequest(message, code, { fieldErrors: { [field]: message } });

exports.changePassword = asyncHandler(async (req, res) => {
  // Never trimmed: spaces are legal password characters.
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = req.body?.confirmPassword ? String(req.body.confirmPassword) : null;

  if (!currentPassword) {
    throw fieldError("currentPassword", "Current password is required.");
  }

  if (!newPassword) {
    throw fieldError("newPassword", "New password is required.");
  }

  if (confirmPassword !== null && confirmPassword !== newPassword) {
    throw fieldError("confirmPassword", "Passwords do not match.");
  }

  if (currentPassword === newPassword) {
    throw fieldError("newPassword", "Your new password must be different from your current password.");
  }

  const problems = validatePasswordStrength(newPassword);
  if (problems.length) {
    throw fieldError("newPassword", problems.join(" "));
  }

  const user = await User.findById(req.user.userId).select("+password");
  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw fieldError("currentPassword", "Current password is incorrect.", ERROR_CODES.INVALID_CREDENTIALS);
  }

  // Saved together, so there is no moment where the new password works while
  // sessions opened with the old one still do.
  user.password = newPassword;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  const changedAt = new Date();
  // Same session id, so this device's live feed and logout keep matching it.
  const { token } = issueSession(user, req.auth.platform, req.auth.sessionId);
  adoptSessionToken(user._id, req.auth.sessionId, token);

  disconnectOtherSessions(user._id, req.auth.sessionId).catch((error) => {
    logger.warn("Other sessions' live feeds not dropped after password change", { errorName: error?.name });
  });

  void createSystemLog({
    req,
    action: "PASSWORD_CHANGED",
    user: { _id: user._id, role: user.role },
    role: user.role,
    description: `${user.fullname} changed their password`,
    resource: "User",
    resourceId: String(user._id),
    metadata: { email: user.email, changedAt: changedAt.toISOString(), otherSessionsSignedOut: true },
  });

  // The password is already saved, so the answer must not wait on email: a
  // stalled mail server used to hold it past the app's timeout, and the app
  // then reported a change that had gone through as failed.
  void sendPasswordChangedEmail({
    email: user.email,
    fullname: user.fullname,
    changedAt,
  }).catch((error) => {
    logger.warn("Password-changed notice not sent", { code: error?.code });
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Password changed successfully.",
    token,
  });
});
