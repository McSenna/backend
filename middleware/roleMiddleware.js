"use strict";

const { forbidden, unauthorized } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

/**
 * Restricts a route to the given roles.
 *
 * Reading `req.user.role` unguarded would throw a TypeError — and so a 500 —
 * if this ever ran before the auth middleware; an explicit 401 says what is
 * actually wrong.
 */
const roleCheck = (roles) => (req, _res, next) => {
  const allowed = Array.isArray(roles) ? roles : [roles];

  if (!req.user) {
    return next(
      unauthorized(
        "Authentication is required to continue. Please log in.",
        ERROR_CODES.AUTHENTICATION_REQUIRED
      )
    );
  }

  if (!allowed.includes(req.user.role)) {
    return next(
      forbidden("You do not have permission to perform this action.")
    );
  }

  return next();
};

module.exports = roleCheck;
