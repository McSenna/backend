"use strict";

const {
  getCategory,
  getCategoryKeysForRole,
  getQueueRole,
} = require("../../config/consultationCategories");
const { forbidden } = require("../../utils/AppError");

const normalizeRole = (user) => String(user?.role || "").trim().toLowerCase();

const assertMayComplete = (user, serviceType) => {
  const role = normalizeRole(user);
  if (getCategoryKeysForRole(role).includes(serviceType)) return;

  const owner = getQueueRole(serviceType);
  throw forbidden(
    `${getCategory(serviceType)?.label ?? "This service"} is completed by the ${owner}, not the ${role || "signed-in user"}.`
  );
};

module.exports = { normalizeRole, assertMayComplete };
