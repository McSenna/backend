"use strict";

/**
 * Wraps an async route handler so a rejected promise is forwarded to the
 * global error middleware instead of becoming an unhandled rejection.
 *
 * This is the only reason controllers in this project no longer need a
 * try/catch whose sole job is `next(error)`.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
module.exports.asyncHandler = asyncHandler;
