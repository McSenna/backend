"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { listEligibleProviders } = require("../../services/appointment/providerService");

exports.listServiceProviders = asyncHandler(async (req, res) => {
  const key = String(req.query.serviceType || req.query.consultationType || "").trim();
  if (!key) {
    throw badRequest("A service type is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const { roles, providers } = await listEligibleProviders(key);

  return res.json({
    success: true,
    message: "Healthcare providers loaded successfully.",
    serviceType: key,
    eligibleRoles: roles,
    providers,
  });
});
