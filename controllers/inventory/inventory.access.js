"use strict";

const { forbidden } = require("../../utils/AppError");
const { permissionsFor, isViewOnly } = require("../../config/inventoryPermissions");

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 8;

// The role comes from the account loaded by the auth middleware, never from the request body.
const assertCan = (req, capability) => {
  const role = req.user?.role;
  if (permissionsFor(role)[capability]) return;
  throw forbidden(
    isViewOnly(role)
      ? "You have view-only access to inventory."
      : "You do not have permission to perform this action."
  );
};

// Route-level guard so a write route refuses before its handler reads the body or the database.
const requireInventory = (capability) => (req, _res, next) => {
  try {
    assertCan(req, capability);
    return next();
  } catch (error) {
    return next(error);
  }
};

const resolvePaging = ({ page, limit }, defaultLimit = DEFAULT_PAGE_SIZE) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const pageLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || defaultLimit));
  return { pageNumber, pageLimit, skip: (pageNumber - 1) * pageLimit };
};

const pagingMeta = (total, pageNumber, pageLimit) => ({
  total,
  page: pageNumber,
  limit: pageLimit,
  totalPages: Math.max(1, Math.ceil(total / pageLimit)),
});

module.exports = {
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  assertCan,
  requireInventory,
  resolvePaging,
  pagingMeta,
};
