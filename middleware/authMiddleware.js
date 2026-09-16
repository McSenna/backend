"use strict";

const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { BLOCKED_STATUSES, resolveUserStatus } = require("../models/User");
const { normalizePlatform } = require("../config/platformAccess");
const { resolveRequestPlatform } = require("../services/platformService");
const { enforcePlatformAccess } = require("./platformMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const { unauthorized } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const logger = require("../utils/logger");

const authenticateSession = async (req) => {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    throw unauthorized(
      "Authentication is required to continue. Please log in.",
      ERROR_CODES.AUTHENTICATION_REQUIRED
    );
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw unauthorized(
      "Authentication is required to continue. Please log in.",
      ERROR_CODES.AUTHENTICATION_REQUIRED
    );
  }

  if (!process.env.JWT_SECRET) {
    logger.error("JWT_SECRET is not configured; cannot verify tokens");
    throw new Error("JWT_SECRET is not configured");
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw unauthorized(
        "Your session has expired. Please log in again.",
        ERROR_CODES.TOKEN_EXPIRED
      );
    }
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      ERROR_CODES.INVALID_TOKEN
    );
  }

  const account = await User.findById(payload.userId)
    .select("_id role verified status")
    .lean();

  if (!account) {
    throw unauthorized(
      "Your account is no longer available. Please log in again.",
      ERROR_CODES.ACCOUNT_NOT_FOUND
    );
  }

  if (!account.verified) {
    throw unauthorized(
      "Your account is not active. Please verify your email or contact the health center.",
      ERROR_CODES.ACCOUNT_UNVERIFIED
    );
  }

  const accountStatus = resolveUserStatus(account);
  if (BLOCKED_STATUSES.includes(accountStatus)) {
    throw unauthorized(
      accountStatus === "suspended"
        ? "This account has been suspended. Please contact your administrator."
        : "This account is inactive. Please contact your administrator.",
      ERROR_CODES.ACCOUNT_DISABLED
    );
  }

  const claimedSessionPlatform = normalizePlatform(payload.platform);
  const requestPlatform = req.clientPlatform || resolveRequestPlatform(req);
  const sessionPlatform = claimedSessionPlatform || requestPlatform.platform;

  req.user = {
    ...payload,
    userId: String(account._id),
    role: account.role,
    status: accountStatus,
  };

  req.auth = {
    platform: sessionPlatform,
    sessionId: payload.sessionId || null,
    issuedAt: payload.iat ? new Date(payload.iat * 1000) : null,
    isLegacySession: !claimedSessionPlatform,
  };
};

const auth = asyncHandler(async (req, res, next) => {
  await authenticateSession(req);
  return enforcePlatformAccess(req, res, next);
});

module.exports = auth;
module.exports.authenticateSession = authenticateSession;
module.exports.enforcePlatformAccess = enforcePlatformAccess;
