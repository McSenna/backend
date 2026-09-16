"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { normalizePlatform } = require("../config/platformAccess");
const logger = require("../utils/logger");

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || "7d";

function requireSecret() {
  if (!process.env.JWT_SECRET) {
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
