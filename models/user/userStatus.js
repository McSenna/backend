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

// Residents normally sit at "approved" and staff at "active"; either one means
// the account may sign in.
const SIGN_IN_READY_STATUSES = ["approved", "active"];

const resolveUserStatus = (user) => {
  if (!user) return "pending";
  if (user.status && VALID_STATUSES.includes(user.status)) return user.status;
  if (user.verified && user.role !== "resident") return "active";
  return user.verified ? "approved" : "pending";
};

module.exports = { VALID_STATUSES, BLOCKED_STATUSES, SIGN_IN_READY_STATUSES, resolveUserStatus };
