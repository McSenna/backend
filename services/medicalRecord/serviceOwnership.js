"use strict";

const {
  getCategory,
  getCategoryKeysForRole,
  getQueueRole,
} = require("../../config/consultationCategories");
const { forbidden, badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const normalizeRole = (user) => String(user?.role || "").trim().toLowerCase();

const assertMayComplete = (user, serviceType) => {
  const role = normalizeRole(user);
  if (getCategoryKeysForRole(role).includes(serviceType)) return;

  const owner = getQueueRole(serviceType);
  throw forbidden(
    `${getCategory(serviceType)?.label ?? "This service"} is completed by the ${owner}, not the ${role || "signed-in user"}.`
  );
};

const ownedServiceKeys = (user) => getCategoryKeysForRole(normalizeRole(user));

// Encoding a past record follows the same ownership as completing a visit:
// admins encode any service, other staff only the services they run.
const assertMayEncode = (user, serviceType) => {
  if (!getCategory(serviceType)) {
    throw badRequest("Choose one of the health center services.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (ownedServiceKeys(user).includes(serviceType)) return;
  throw forbidden(
    `${getCategory(serviceType).label} records are encoded by the ${getQueueRole(serviceType)} or an admin.`
  );
};

module.exports = { normalizeRole, assertMayComplete, assertMayEncode, ownedServiceKeys };
