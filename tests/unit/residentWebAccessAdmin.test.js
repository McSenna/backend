"use strict";
const assert = require("node:assert/strict");
const { canManageResidentWebAccess } = require("../../config/residentWebAccessAdmin");
const id = "000000000000000000000001";
process.env.RESIDENT_WEB_ACCESS_ADMIN_ID = id;
const admin = { _id: id, role: "admin", status: "active", verified: true };
assert.equal(canManageResidentWebAccess(admin), true);
assert.equal(canManageResidentWebAccess({ ...admin, fullname: "Renamed", email: "renamed@example.test", username: "changed" }), true);
assert.equal(canManageResidentWebAccess({ ...admin, _id: "000000000000000000000002", fullname: "Kape Maslog" }), false);
for (const status of ["pending", "rejected", "suspended", "deactivated", "inactive"])
  assert.equal(canManageResidentWebAccess({ ...admin, status }), false, status);
assert.equal(canManageResidentWebAccess({ _id: id, role: "admin", verified: true }), true, "legacy verified admin");
assert.equal(canManageResidentWebAccess({ _id: id, role: "admin" }), false);
for (const role of ["superadmin", "resident", "doctor"])
  assert.equal(canManageResidentWebAccess({ ...admin, role }), false);
assert.equal(canManageResidentWebAccess(null), false);
for (const value of ["", "ADM-2026-5BE2", "bad-id"]) {
  process.env.RESIDENT_WEB_ACCESS_ADMIN_ID = value;
  assert.equal(canManageResidentWebAccess(admin), false);
}
console.log("residentWebAccessAdmin: all checks passed");
