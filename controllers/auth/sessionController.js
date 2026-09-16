"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { authenticate } = require("../../services/auth/loginService");
const { buildUserResponse, platformOf } = require("../../services/auth/authResponse");

exports.login = asyncHandler(async (req, res) => {
  const platform = platformOf(req);
  const { email, password } = req.body;

  const { user, token } = await authenticate({ req, email, password, platform });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Login successful.",
    token,
    user: buildUserResponse(user),
    platform,
  });
});

exports.logout = asyncHandler(async (req, res) => {
  const actor = req.user || {};

  await createSystemLog({
    req,
    action: "LOGOUT",
    user: actor,
    role: actor.role,
    description: `User logged out of the ${req.auth?.platform || "unknown"} platform`,
    resource: "Auth",
    success: true,
    metadata: { platform: req.auth?.platform, sessionId: req.auth?.sessionId },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Logout successful.",
  });
});
