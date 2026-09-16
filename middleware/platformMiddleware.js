"use strict";

const { PLATFORMS } = require("../config/platformAccess");
const {
  resolveRequestPlatform,
  getPlatformDenial,
} = require("../services/platformService");
const { forbidden, unauthorized } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

function attachRequestPlatform(req, _res, next) {
  req.clientPlatform = resolveRequestPlatform(req);
  return next();
}

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
