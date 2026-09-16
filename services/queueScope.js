"use strict";

const {
  QUEUE_ROLES,
  getCategoryKeysForRole,
  getQueueRole,
} = require("../config/consultationCategories");

const STAFF_ROLES = ["doctor", "admin", "midwife", "bhw"];

const BOOKED_STATUSES = ["confirmed", "rescheduled"];

const SLOT_OCCUPYING_STATUSES = ["confirmed", "rescheduled", "processing", "completed"];

function resolveQueueScope(req) {
  const signedInRole = String(req.user?.role || "").trim().toLowerCase();
  const isAdmin = signedInRole === "admin";

  const requestedRole = String(req.query?.role || "").trim().toLowerCase();
  const scopeRole = isAdmin && QUEUE_ROLES.includes(requestedRole) ? requestedRole : signedInRole;

  if (isAdmin && !QUEUE_ROLES.includes(requestedRole)) {
    return { scopeRole: "admin", categoryKeys: null };
  }

  return { scopeRole, categoryKeys: getCategoryKeysForRole(scopeRole) };
}

function applyCategoryFilter(categoryKeys, requestedKey) {
  const key = String(requestedKey || "").trim();
  if (!key) return categoryKeys;
  if (categoryKeys === null) return [key];
  return categoryKeys.includes(key) ? [key] : [];
}

function queueFilter(visibleKeys) {
  return visibleKeys === null ? {} : { consultationType: { $in: visibleKeys } };
}

function withQueueRole(appointment) {
  return { ...appointment, queueRole: getQueueRole(appointment.consultationType) };
}

module.exports = {
  STAFF_ROLES,
  BOOKED_STATUSES,
  SLOT_OCCUPYING_STATUSES,
  resolveQueueScope,
  applyCategoryFilter,
  queueFilter,
  withQueueRole,
};
