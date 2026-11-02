"use strict";

const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

// `approved` means allowed to sign in but has not yet; the first successful
// sign-in makes it `active`. `inactive` and `suspended` are older stored names
// for a deactivated account: never written now, still readable and reversible.
const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["approved", "rejected"]),
  rejected: Object.freeze(["approved"]),
  approved: Object.freeze(["active", "deactivated"]),
  active: Object.freeze(["deactivated"]),
  deactivated: Object.freeze(["active"]),
  inactive: Object.freeze(["active"]),
  suspended: Object.freeze(["active"]),
});

const SEGMENTS = Object.freeze({
  active: Object.freeze(["approved", "active"]),
  requests: Object.freeze(["pending"]),
  rejected: Object.freeze(["rejected"]),
  deactivated: Object.freeze(["deactivated", "inactive", "suspended"]),
  all: Object.freeze(["approved", "active", "pending", "rejected", "deactivated", "inactive", "suspended"]),
});

const STATUS_GROUPS = Object.freeze({
  pending: "requested",
  approved: "approved",
  active: "active",
  rejected: "rejected",
  deactivated: "deactivated",
  inactive: "deactivated",
  suspended: "deactivated",
});

const canTransition = (from, to) => (ALLOWED_TRANSITIONS[from] ?? []).includes(to);

const assertTransition = (from, to) => {
  if (canTransition(from, to)) return;
  throw conflict("This account changed and that action no longer applies. Reload the list and try again.", ERROR_CODES.INVALID_TRANSITION);
};

const statusGroupOf = (status) => STATUS_GROUPS[status] ?? "requested";

module.exports = { ALLOWED_TRANSITIONS, SEGMENTS, canTransition, assertTransition, statusGroupOf };
