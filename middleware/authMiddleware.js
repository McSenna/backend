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

/**
 * Authenticates the bearer token and confirms the account behind it is still
 * usable.
 *
 * Every rejection here is a 401 carrying a machine code, so the client can tell
 * an expired session (re-login) apart from a malformed token (drop the session)
 * without parsing prose. A missing JWT secret is a server fault, not the
 * caller's, and stays a 500 through the global handler.
 *
 * The account's role, status and platform are re-read on every request rather
 * than trusted from the token, so a suspension, a role change or the platform
 * policy takes effect immediately instead of when the token happens to expire.
 */
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
    // Misconfiguration, not a client error: let it fall through as a 500 so it
    // is loud in the logs rather than masquerading as a rejected login.
    logger.error("JWT_SECRET is not configured; cannot verify tokens");
    throw new Error("JWT_SECRET is not configured");
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    // jsonwebtoken distinguishes expiry from tampering; preserve that.
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

  // A structurally valid token can still belong to an account that was deleted
  // or unverified after the token was issued.
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

  // Account standing is an administrator's decision and can change while a
  // session is open. A 401 (rather than a 403) is deliberate: the session is
  // finished, and the client's 401 handling already clears it.
  const accountStatus = resolveUserStatus(account);
  if (BLOCKED_STATUSES.includes(accountStatus)) {
    throw unauthorized(
      accountStatus === "suspended"
        ? "This account has been suspended. Please contact your administrator."
        : "This account is inactive. Please contact your administrator.",
      ERROR_CODES.ACCOUNT_DISABLED
    );
  }

  // Sessions issued before platform binding existed carry no claim. Rather
  // than trusting them as "any platform", the platform is resolved from the
  // request itself, so an old resident token still cannot be used from a
  // browser while staff sessions keep working.
  const claimedSessionPlatform = normalizePlatform(payload.platform);
  const requestPlatform = req.clientPlatform || resolveRequestPlatform(req);
  const sessionPlatform = claimedSessionPlatform || requestPlatform.platform;

  // Trust the stored role over the token's copy so a role change takes effect
  // without waiting for the token to expire.
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

/**
 * The guard every protected route uses: authenticate, then apply the platform
 * matrix. Composed here rather than added route by route so a new endpoint is
 * platform-protected the moment it is authenticated.
 */
const auth = asyncHandler(async (req, res, next) => {
  await authenticateSession(req);
  return enforcePlatformAccess(req, res, next);
});

module.exports = auth;
module.exports.authenticateSession = authenticateSession;
module.exports.enforcePlatformAccess = enforcePlatformAccess;
