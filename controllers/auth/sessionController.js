"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const logger = require("../../utils/logger");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { authenticate } = require("../../services/auth/loginService");
const { buildUserResponse, platformOf } = require("../../services/auth/authResponse");
const { badRequest } = require("../../utils/AppError");
const { disconnectSession, disconnectUser } = require("../../realtime/socketServer");
const { describeDevice, endAllSessions, endSession, listActiveSessions } = require("../../services/auth/authSessions");

exports.login = asyncHandler(async (req, res) => {
  const platform = platformOf(req);
  const { email, password } = req.body;

  const { user, token, policy } = await authenticate({ req, email, password, platform });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Login successful.",
    token,
    user: buildUserResponse(user, policy),
    platform,
  });
});

const LOGOUT_SCOPES = new Set(["this", "all"]);

/**
 * scope "this" (the default, and what older app versions send by omitting it)
 * ends this session. scope "all" revokes every session of the account,
 * this one included, and drops all their live connections.
 */
exports.logout = asyncHandler(async (req, res) => {
  const actor = req.user || {};
  const scope = req.body?.scope ?? "this";
  if (!LOGOUT_SCOPES.has(scope)) {
    throw badRequest('Choose "this" or "all" devices to log out of.');
  }
  const { sessionId, platform } = req.auth || {};

  await require("../../services/notification/pushDevices").releaseSession(actor.userId, sessionId);
  if (scope === "all") await endAllSessions(actor.userId);
  else await endSession(sessionId);

  await createSystemLog({
    req,
    action: "LOGOUT",
    user: actor,
    role: actor.role,
    description: scope === "all"
      ? `User logged out of every device from the ${platform || "unknown"} platform`
      : `User logged out of the ${platform || "unknown"} platform`,
    resource: "Auth",
    success: true,
    metadata: { platform, sessionId, scope },
  });

  // A single-device logout leaves the token valid until it expires, but its live feed ends now.
  const disconnect = scope === "all" ? Promise.resolve(disconnectUser(actor.userId)) : disconnectSession(actor.userId, sessionId);
  disconnect.catch((error) =>
    logger.warn("Logout could not close the live connection", { errorName: error?.name }),
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Logout successful.",
    scope,
  });
});

/**
 * The account's active sessions, newest first. Other sessions' ids never leave
 * the server. A session signed in before sessions were recorded has no row,
 * so this one is added from its token to keep the count honest.
 */
exports.listSessions = asyncHandler(async (req, res) => {
  const { sessionId, platform, issuedAt } = req.auth || {};
  const rows = await listActiveSessions(req.user.userId);
  const sessions = rows.map((row) => ({
    current: row.sessionId === sessionId,
    platform: row.platform,
    device: row.device,
    signedInAt: row.createdAt,
  }));
  if (!sessions.some((session) => session.current)) {
    sessions.unshift({ current: true, platform, device: describeDevice(req.get("user-agent")), signedInAt: issuedAt });
  }

  res.set("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).json({ success: true, count: sessions.length, sessions });
});
