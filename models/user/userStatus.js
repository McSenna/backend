"use strict";

const VALID_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
  "deactivated",
  "active",
  "inactive",
];

const BLOCKED_STATUSES = ["pending", "rejected", "suspended", "deactivated", "inactive"];

const resolveUserStatus = (user) => {
  if (!user) return "pending";
  if (user.status && VALID_STATUSES.includes(user.status)) return user.status;
  if (user.verified && user.role !== "resident") return "active";
  return user.verified ? "approved" : "pending";
};

module.exports = { VALID_STATUSES, BLOCKED_STATUSES, resolveUserStatus };
