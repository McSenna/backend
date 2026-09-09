"use strict";

const { PLATFORMS } = require("../config/platformAccess");
const {
  resolveRequestPlatform,
  getPlatformDenial,
} = require("../services/platformService");
const { forbidden, unauthorized } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

/**
 * Attaches the resolved platform of the current request to `req.clientPlatform`.
 *
 * Mounted once in server.js ahead of the routes so unauthenticated endpoints
 * (login, registration) and the audit log see the same value the authenticated
 * guards do, instead of each re-deriving it from the headers.
 */
function attachRequestPlatform(req, _res, next) {
  req.clientPlatform = resolveRequestPlatform(req);
  return next();
}

/**
 * Enforces the platform matrix on an authenticated request.
 *
 * Two distinct failures live here:
 *
 *  1. Policy — the role may not use the platform this session was issued for.
 *     A resident can only reach this if a token was somehow minted for the web,
 *     which the login path refuses to do; it is caught anyway so the API does
 *     not depend on the login path being the only way in.
 *
 *  2. Context — the session says "mobile" but the request carries browser-only
 *     headers. That is a mobile token replayed from a browser (copied out of
 *     the app, or pasted into a devtools console). The signature is valid, so
 *     token verification alone would accept it; the platform binding is what
 *     rejects it.
 *
 * Runs as part of the authenticate chain so every protected route is covered
 * without each route file having to remember to add it.
 */
function enforcePlatformAccess(req, _res, next) {
  if (!req.user || !req.auth) {
    return next(
      unauthorized(
        "Authentication is required to continue. Please log in.",
        ERROR_CODES.AUTHENTICATION_REQUIRED
      )
    );
  }

  const { role } = req.user;
  const sessionPlatform = req.auth.platform;

  const denial = getPlatformDenial(role, sessionPlatform);
  if (denial) {
    return next(forbidden(denial.message, denial.code));
  }

  const request = req.clientPlatform || resolveRequestPlatform(req);
  if (sessionPlatform === PLATFORMS.MOBILE && request.isBrowserRequest) {
    return next(
      forbidden(
        "This session is not valid on this platform. Please log in again.",
        ERROR_CODES.PLATFORM_CONTEXT_MISMATCH
      )
    );
  }

  return next();
}

module.exports = {
  attachRequestPlatform,
  enforcePlatformAccess,
};
