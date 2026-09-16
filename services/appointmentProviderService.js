"use strict";

const User = require("../models/User");
const { BLOCKED_STATUSES, resolveUserStatus } = require("../models/User");
const {
  getCategory,
  getEligibleProviderRoles,
  isProviderRoleAllowed,
} = require("../config/consultationCategories");
const { badRequest } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const { assertValidObjectId } = require("../utils/objectId");

const listEligibleProviders = async (serviceKey) => {
  const category = getCategory(serviceKey);
  if (!category) {
    throw badRequest("The selected service is not available.", ERROR_CODES.VALIDATION_ERROR);
  }

  const roles = getEligibleProviderRoles(serviceKey);
  const staff = await User.find({ role: { $in: roles }, verified: true })
    .select("_id fullname role status verified profilePhoto")
    .sort({ fullname: 1 })
    .lean();

  const providers = staff
    .filter((member) => !BLOCKED_STATUSES.includes(resolveUserStatus(member)))
    .map((member) => ({
      _id: String(member._id),
      fullname: member.fullname,
      role: member.role,
      profilePhoto: member.profilePhoto || null,
    }));

  return { roles, providers };
};

const resolvePreferredProvider = async (preferredProvider, categoryKey) => {
  if (!preferredProvider) return null;

  const providerId = assertValidObjectId(preferredProvider, "healthcare provider");
  const provider = await User.findById(providerId).select("_id role verified status").lean();

  if (!provider || !provider.verified || BLOCKED_STATUSES.includes(resolveUserStatus(provider))) {
    throw badRequest(
      "The selected healthcare provider is not available.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  if (!isProviderRoleAllowed(categoryKey, provider.role)) {
    throw badRequest(
      `${getCategory(categoryKey).label} is not handled by the selected healthcare provider.`,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  return providerId;
};

module.exports = { listEligibleProviders, resolvePreferredProvider };
