"use strict";
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const SystemLog = require("../../models/SystemLog");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const { assertAdminChangeAllowed, assertAdminRemains } = require("../../services/userDirectory/adminGuards");
const { undoDeactivation } = require("../../services/userDirectory/accountActions");

const password = "SyntheticPass123!";
let seq = 0;
const make = (role, status, extra = {}) => {
  seq += 1;
  return User.create({ fullname: `Synthetic ${role} ${seq}`, email: `${role}.${seq}@maslogcare.test`, password, role, status, verified: ["approved", "active"].includes(status), gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Test address", ...extra });
};
const stored = (user) => User.findById(user._id).lean();

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  await require("../../models/ResidentWebPolicy").updateOne({ _id: "resident-web" }, { $set: { enabled: true } });
  const admin = await make("admin", "active");
  const headers = h.asAdmin(admin);
  const act = (user, body) => h.request(`/users/${user._id}/status`, { method: "PATCH", headers, body });

  const resident = await make("resident", "active");
  const off = await act(resident, { action: "deactivate" });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.user.statusGroup, "deactivated");
  assert.equal(off.body.user.id, String(resident._id));
  let row = await stored(resident);
  assert.equal(row.status, "deactivated");
  assert.equal(String(row.deactivated_by), String(admin._id));
  assert.ok(row.deactivated_at);
  const again = await act(resident, { action: "deactivate" });
  assert.equal(again.status, 409, "a stale second deactivate");
  assert.equal(again.body.code, "INVALID_TRANSITION");
  assert.equal((await act(resident, { action: "reactivate" })).status, 200);
  row = await stored(resident);
  assert.equal(row.status, "active");
  assert.equal(row.deactivated_by, null);
  assert.equal(row.deactivated_at, null);

  for (const legacy of ["inactive", "suspended"]) {
    const older = await make("midwife", legacy);
    assert.equal((await act(older, { action: "reactivate" })).status, 200, legacy);
    assert.equal((await stored(older)).status, "active", legacy);
  }
  const noStatus = await make("bhw", "active");
  await User.collection.updateOne({ _id: noStatus._id }, { $unset: { status: "" } });
  assert.equal((await act(noStatus, { action: "deactivate" })).status, 200, "an account with no stored status");

  const pendingPlain = await make("resident", "pending");
  assert.equal((await act(pendingPlain, { action: "deactivate" })).body.code, "INVALID_TRANSITION");
  assert.equal((await act(pendingPlain, { status: "active" })).status, 400, "the free-form status body is gone");
  assert.equal((await act(pendingPlain, { action: "reject" })).status, 400, "reject needs a reason");
  assert.equal((await act(pendingPlain, { action: "reject", reason: "Other" })).status, 400, "Other needs remarks");
  const rejectedPlain = await act(pendingPlain, { action: "reject", reason: "Unreadable ID" });
  assert.equal(rejectedPlain.status, 200, JSON.stringify(rejectedPlain.body));
  assert.equal((await stored(pendingPlain)).rejection_reason, "Unreadable ID");
  const pendingOk = await make("resident", "pending");
  assert.equal((await act(pendingOk, { action: "approve" })).status, 200);
  row = await stored(pendingOk);
  assert.equal(row.status, "approved");
  assert.equal(row.verified, true);
  assert.equal(String(row.approved_by), String(admin._id));

  const self = await act(admin, { action: "deactivate" });
  assert.equal(self.status, 403);
  assert.equal(self.body.code, "SELF_ACTION_FORBIDDEN");
  assert.equal((await act(admin, { action: "reactivate" })).status, 403);

  const secondAdmin = await make("admin", "active");
  await assert.rejects(assertAdminChangeAllowed({ actorId: String(admin._id), target: await stored(admin) }), (error) => error.code === "SELF_ACTION_FORBIDDEN");
  await User.updateOne({ _id: secondAdmin._id }, { $set: { status: "deactivated" } });
  await assert.rejects(assertAdminChangeAllowed({ actorId: "507f1f77bcf86cd799439011", target: await stored(admin) }), (error) => error.code === "LAST_ADMIN");
  await User.updateOne({ _id: secondAdmin._id }, { $set: { status: "active" } });
  await assertAdminChangeAllowed({ actorId: String(secondAdmin._id), target: await stored(admin) });

  await User.updateOne({ _id: admin._id }, { $set: { status: "deactivated" } });
  await User.updateOne({ _id: secondAdmin._id }, { $set: { status: "deactivated" } });
  let reverted = false;
  await assert.rejects(assertAdminRemains(async () => { reverted = true; }), (error) => error.code === "LAST_ADMIN");
  assert.equal(reverted, true, "no admin left reverts the write");
  await User.updateMany({ _id: { $in: [admin._id, secondAdmin._id] } }, { $set: { status: "active" } });

  const noStatusAdmin = await make("admin", "active");
  await User.collection.updateOne({ _id: noStatusAdmin._id }, { $unset: { status: "" }, $set: { verified: true } });
  const before = await stored(noStatusAdmin);
  await User.updateOne({ _id: noStatusAdmin._id }, { $set: { status: "deactivated", deactivated_by: admin._id, deactivated_at: new Date() } });
  await User.updateOne({ _id: noStatusAdmin._id }, undoDeactivation(before));
  const undone = await stored(noStatusAdmin);
  assert.equal(undone.status, undefined, "an admin with no stored status gets none back, not a stuck deactivated");
  assert.equal(undone.deactivated_by, null);
  assert.equal(undone.deactivated_at, null);
  await User.deleteOne({ _id: noStatusAdmin._id });
  const storedAdmin = await make("admin", "active");
  await User.updateOne({ _id: storedAdmin._id }, { $set: { status: "deactivated", deactivated_by: admin._id, deactivated_at: new Date() } });
  await User.updateOne({ _id: storedAdmin._id }, undoDeactivation({ status: "active" }));
  const undoneStored = await stored(storedAdmin);
  assert.equal(undoneStored.status, "active");
  assert.equal(undoneStored.deactivated_at, null);
  await User.deleteOne({ _id: storedAdmin._id });

  const secondHeaders = h.asAdmin(secondAdmin);
  await Promise.all([
    h.request(`/users/${secondAdmin._id}/status`, { method: "PATCH", headers, body: { action: "deactivate" } }),
    h.request(`/users/${admin._id}/status`, { method: "PATCH", headers: secondHeaders, body: { action: "deactivate" } }),
  ]);
  const left = await User.countDocuments({ role: "admin", status: { $in: ["active", "approved"] } });
  assert.ok(left >= 1, "two admins acting at once leave at least one");
  await User.updateMany({ _id: { $in: [admin._id, secondAdmin._id] } }, { $set: { status: "active" } });

  const fresh = await make("resident", "approved");
  const login = (user, pw = password) => h.request("/login", { method: "POST", body: { email: user.email, password: pw, clientPlatform: "web" } });
  assert.notEqual((await login(fresh, "WrongPassword123!")).status, 200);
  assert.equal((await stored(fresh)).status, "approved", "a failed password does not promote");
  assert.equal((await login(fresh)).status, 200);
  assert.equal((await stored(fresh)).status, "active", "first sign-in promotes");
  const signedInAt = (await stored(fresh)).updatedAt;
  assert.equal((await login(fresh)).status, 200);
  assert.equal((await stored(fresh)).status, "active");
  assert.ok(signedInAt);
  const blocked = await make("resident", "approved", { residentWebAccessOverride: "block" });
  assert.notEqual((await login(blocked)).status, 200);
  assert.equal((await stored(blocked)).status, "approved", "a refused sign-in does not promote");

  const request = await h.register({});
  assert.ok(request.verification, JSON.stringify(request.response.body));
  const userRow = () => User.findById(request.user._id).lean();
  assert.equal((await act(request.user, { action: "approve" })).body.code, "USE_ID_REVIEW");
  assert.equal((await act(request.user, { action: "reject", reason: "Unreadable ID" })).body.code, "USE_ID_REVIEW");
  const review = (verb, body) => h.request(`/admin/user-requests/${request.verification._id}/${verb}`, { method: "PATCH", headers, body });
  assert.equal((await review("reject", { reason: "Unreadable ID" })).status, 200);
  assert.equal((await userRow()).status, "rejected");
  assert.equal((await act(request.user, { action: "approve" })).body.code, "USE_ID_REVIEW", "a rejected request with an ID goes back through review");
  assert.equal((await review("reject", { reason: "Unreadable ID" })).status, 409, "a rejected request cannot be rejected again");
  const reopened = await review("approve", {});
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  row = await userRow();
  assert.equal(row.status, "approved");
  assert.equal(row.rejection_reason, "");
  assert.equal(row.rejected_at, null);
  const reopenLog = await SystemLog.findOne({ action: "USER_APPROVED", resourceId: String(request.user._id) }).lean();
  assert.equal(reopenLog.metadata.previousVerificationStatus, "rejected", "the log records the earlier decision");
  assert.equal((await review("approve", {})).status, 409, "an approved request cannot be approved again");

  const offAgain = await make("resident", "deactivated");
  const staleRequest = await h.register({});
  await h.request(`/admin/user-requests/${staleRequest.verification._id}/reject`, { method: "PATCH", headers, body: { reason: "Unreadable ID" } });
  await User.updateOne({ _id: staleRequest.user._id }, { $set: { status: offAgain.status } });
  assert.equal((await h.request(`/admin/user-requests/${staleRequest.verification._id}/approve`, { method: "PATCH", headers, body: {} })).body.code, "INVALID_TRANSITION", "approving never reactivates a deactivated account");

  const activeResident = await make("resident", "active");
  const linkBlocked = await h.request(`/admin/users/${activeResident._id}/master-link`, { method: "PATCH", headers, body: { masterResidentId: "TEST-NOPE", reason: "Synthetic" } });
  assert.notEqual(linkBlocked.body.message, "Only approved or active accounts can be linked. Review the user request first.", "an active resident can be linked");

  const logged = await SystemLog.findOne({ action: "USER_STATUS_CHANGED", resourceId: String(resident._id) }).sort({ createdAt: 1 }).lean();
  assert.equal(String(logged.userId), String(admin._id));
  assert.equal(logged.role, "admin");
  assert.equal(logged.metadata.previousStatus, "active");
  assert.equal(logged.metadata.newStatus, "deactivated");
  assert.ok(logged.ipAddress);
  const statusBefore = (await stored(resident)).status;
  assert.equal((await h.request("/users/status", { method: "PATCH", headers, body: { ids: [String(resident._id)], action: "deactivate" } })).status, 400, "the bulk route is gone; that path is now an invalid id");
  assert.equal((await stored(resident)).status, statusBefore);
  assert.equal((await h.request(`/users/${resident._id}/status`, { method: "PATCH", headers: h.asAdmin(await make("doctor", "active")), body: { action: "deactivate" } })).status, 403);
  console.log("User management action assertions passed");
};
run().then(() => h.teardown()).catch(async (error) => { console.error(error); await h.teardown(); process.exitCode = 1; });
