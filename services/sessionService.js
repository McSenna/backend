"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { normalizePlatform } = require("../config/platformAccess");
const logger = require("../utils/logger");

/**
 * Issues and reads authenticated sessions.
 *
 * A session is a signed JWT whose payload carries the platform it was created
 * for. That claim is what makes platform authorization enforceable after
 * login: the request body's `clientPlatform` is a client assertion, but the
 * platform inside a signed token was decided by the server at login time and
 * cannot be edited without invalidating the signature.
 *
 * `sessionId` identifies this sign-in specifically, so a staff member's web
 * and mobile sessions are distinguishable in the audit log and one can be
 * reasoned about without touching the other.
 */

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || "7d";

function requireSecret() {
  if (!process.env.JWT_SECRET) {
    // Configuration fault, not a client error — surfaces as a logged 500.
    logger.error("JWT_SECRET is not configured; cannot issue tokens");
    throw new Error("JWT_SECRET is not configured");
  }
  return process.env.JWT_SECRET;
}

function buildTokenPayload(user, platform, sessionId) {
  return {
    userId: user._id,
    email: user.email,
    role: user.role,
    platform,
    sessionId,
  };
}

/**
 * Creates a session bound to one role and one platform.
 *
 * Callers must have already established that the platform is allowed for the
 * role — this function signs what it is given and does not re-check policy, so
 * the check stays in one place (the login flow) rather than being half-done in
 * two.
 */
function issueSession(user, platform) {
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) {
    throw new Error(`Cannot issue a session for unknown platform: ${platform}`);
  }

  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    buildTokenPayload(user, normalizedPlatform, sessionId),
    requireSecret(),
    { expiresIn: TOKEN_TTL }
  );

  return { token, sessionId, platform: normalizedPlatform };
}

module.exports = {
  TOKEN_TTL,
  buildTokenPayload,
  issueSession,
};
