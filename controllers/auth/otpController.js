"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const logger = require("../../utils/logger");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { sendWelcomeEmail } = require("../../services/mailer");
const { createSystemLog } = require("../../services/systemLogService");
const { issueSession } = require("../../services/sessionService");
const { getPlatformDenial } = require("../../services/platformService");
const { resendOtp } = require("../../services/auth/otpResendService");
const { verifyRegistrationOtp } = require("../../services/auth/otpVerificationService");
const { buildUserResponse, platformOf } = require("../../services/auth/authResponse");

exports.sendOtp = asyncHandler(async (req, res) => {
  await resendOtp(req.body.email);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "A new verification code has been sent to your email.",
  });
});

const sendWelcome = (user) => {
  void sendWelcomeEmail(user.email, user.fullname).catch((emailError) => {
    logger.warn("Welcome email delivery failed", {
      errorName: emailError?.name,
      errorCode: emailError?.code,
    });
  });
};

const respondWithPlatformDenial = async ({ req, res, user, platform, denial }) => {
  await createSystemLog({
    req,
    action: "RESIDENT_WEB_LOGIN_BLOCKED",
    user,
    role: user.role,
    description:
      "Registration completed but no web session was issued: resident accounts are mobile-only",
    resource: "Auth",
    resourceId: String(user._id),
    success: false,
    clientPlatform: platform,
    metadata: { platform, reason: "platform_not_allowed" },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    code: denial.code,
    message: `Registration completed successfully. ${denial.message}`,
    token: null,
    user: buildUserResponse(user),
    platform,
  });
};

exports.verifyOtp = asyncHandler(async (req, res) => {
  const user = await verifyRegistrationOtp(req.body);

  sendWelcome(user);

  await createSystemLog({
    req,
    action: "USER_CREATED",
    user,
    role: user.role,
    description: "Resident account was created and verified",
    resource: "User",
    resourceId: String(user._id),
    metadata: { email: user.email },
  });

  const platform = platformOf(req);
  const denial = getPlatformDenial(user.role, platform);

  if (denial) {
    return respondWithPlatformDenial({ req, res, user, platform, denial });
  }

  const { token } = issueSession(user, platform);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Registration completed successfully.",
    token,
    user: buildUserResponse(user),
    platform,
  });
});
