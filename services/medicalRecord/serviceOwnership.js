"use strict";

const {
  getCategory,
  getCategoryKeysForRole,
  getQueueRole,
} = require("../../config/consultationCategories");
const { forbidden, badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const normalizeRole = (user) => String(user?.role || "").trim().toLowerCase();

const assertMayWriteRecords = (user) => {
  if (!["doctor", "midwife", "bhw"].includes(normalizeRole(user))) {
    throw forbidden("Only clinical staff may change medical records. Administrator access is read-only.");
  }
};

const assertMayComplete = (user, serviceType) => {
  assertMayWriteRecords(user);
  const role = normalizeRole(user);
  if (serviceType === "immunization" && role !== "midwife") throw forbidden("Only a midwife may change immunization records.");
  if (getCategoryKeysForRole(role).includes(serviceType)) return;

  const owner = getQueueRole(serviceType);
  throw forbidden(
    `${getCategory(serviceType)?.label ?? "This service"} is completed by the ${owner}, not the ${role || "signed-in user"}.`
  );
};

const ownedServiceKeys = (user) => getCategoryKeysForRole(normalizeRole(user));

// Encoding a past record follows the same ownership as completing a visit:
// clinical staff encode only the services they run. Admins retain read access.
const assertMayEncode = (user, serviceType) => {
  assertMayWriteRecords(user);
  if (serviceType === "immunization" && normalizeRole(user) !== "midwife") throw forbidden("Only a midwife may change immunization records.");
  if (!getCategory(serviceType)) {
    throw badRequest("Choose one of the health center services.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (ownedServiceKeys(user).includes(serviceType)) return;
  throw forbidden(
    `${getCategory(serviceType).label} records are encoded by the ${getQueueRole(serviceType)}.`
  );
};

module.exports = { normalizeRole, assertMayWriteRecords, assertMayComplete, assertMayEncode, ownedServiceKeys };
