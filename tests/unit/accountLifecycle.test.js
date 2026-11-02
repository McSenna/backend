"use strict";

const assert = require("node:assert/strict");
const {
  ALLOWED_TRANSITIONS,
  SEGMENTS,
  assertTransition,
  canTransition,
  statusGroupOf,
} = require("../../services/userDirectory/accountLifecycle");
const { VALID_STATUSES } = require("../../models/user/userStatus");

const ALLOWED = new Set([
  "pending>approved",
  "pending>rejected",
  "rejected>approved",
  "approved>active",
  "approved>deactivated",
  "active>deactivated",
  "deactivated>active",
  "inactive>active",
  "suspended>active",
]);

for (const from of VALID_STATUSES) {
  for (const to of VALID_STATUSES) {
    assert.equal(canTransition(from, to), ALLOWED.has(`${from}>${to}`), `${from} to ${to}`);
  }
}
assert.equal(Object.keys(ALLOWED_TRANSITIONS).length, 7);

assert.throws(() => assertTransition("rejected", "active"), (error) => error.statusCode === 409 && error.code === "INVALID_TRANSITION");
assert.doesNotThrow(() => assertTransition("deactivated", "active"));

const groups = { pending: "requested", approved: "approved", active: "active", rejected: "rejected", deactivated: "deactivated", inactive: "deactivated", suspended: "deactivated" };
for (const [status, group] of Object.entries(groups)) assert.equal(statusGroupOf(status), group);

assert.deepEqual(SEGMENTS.active, ["approved", "active"]);
assert.deepEqual(SEGMENTS.requests, ["pending"]);
assert.deepEqual(SEGMENTS.rejected, ["rejected"]);
assert.deepEqual(SEGMENTS.deactivated, ["deactivated", "inactive", "suspended"]);
assert.equal(SEGMENTS.all.length, VALID_STATUSES.length);
assert.deepEqual([...SEGMENTS.all].sort(), [...VALID_STATUSES].sort());

// New fields and vocabulary the routes rely on.
const User = require("../../models/User");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { VALID_ACTIONS } = require("../../models/systemLog/logVocabulary");
assert.equal(User.schema.path("residentWebAccessOverride").defaultValue, null);
assert.deepEqual(User.schema.path("residentWebAccessOverride").enumValues.filter(Boolean), ["allow", "block"]);
assert.ok(User.schema.path("deactivated_by"));
assert.ok(User.schema.path("deactivated_at"));
for (const code of ["INVALID_TRANSITION", "LAST_ADMIN", "SELF_ACTION_FORBIDDEN", "USE_ID_REVIEW", "EMAIL_SEND_FAILED", "RATE_LIMITED"]) assert.equal(ERROR_CODES[code], code);
for (const action of ["USERS_EXPORTED", "USER_PASSWORD_RESET_SENT"]) assert.ok(VALID_ACTIONS.includes(action), action);
const indexes = User.schema.indexes().map(([fields]) => JSON.stringify(fields));
assert.ok(indexes.includes(JSON.stringify({ lastLogin: -1, _id: -1 })));
assert.ok(indexes.includes(JSON.stringify({ createdAt: -1, _id: -1 })));

console.log("accountLifecycle: all checks passed");
