"use strict";

const { forbidden } = require("../../utils/AppError");
const { permissionsFor } = require("../../config/inventoryPermissions");

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 8;

const assertCan = (req, capability) => {
  if (!permissionsFor(req.user?.role)[capability]) {
    throw forbidden("You do not have permission to perform this action.");
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

module.exports = { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, assertCan, resolvePaging, pagingMeta };
