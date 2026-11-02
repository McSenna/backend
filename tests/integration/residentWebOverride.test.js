"use strict";
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const { accessView, initializeResidentWebAccess } = require("../../services/residentWebAccess");

const password = "SyntheticPassword123!";
const account = (role, suffix, extra = {}) =>
  User.create({ fullname: `Synthetic ${suffix}`, email: `${suffix}@maslogcare.test`, password, role, status: role === "resident" ? "approved" : "active", verified: true, gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Test address", ...extra });
const webLogin = (user) => h.request("/login", { method: "POST", body: { email: user.email, password, clientPlatform: "web" } });

const CASES = [
  { global: false, override: null, status: 403, state: "global_blocked" },
  { global: false, override: "allow", status: 200, state: "exception_allowed" },
  { global: false, override: "block", status: 403, state: "individual_blocked" },
  { global: true, override: null, status: 200, state: "global_allowed" },
  { global: true, override: "allow", status: 200, state: "individual_allowed" },
  { global: true, override: "block", status: 403, state: "individual_blocked" },
];

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  const admin = await account("admin", "admin");
  process.env.RESIDENT_WEB_ACCESS_ADMIN_ID = String(admin._id);
  const headers = h.asAdmin(admin);

  for (const [index, { global, override, status, state }] of CASES.entries()) {
    await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: global } });
    const user = await account("resident", `case${index}`, { residentWebAccessOverride: override });
    const label = `global ${global}, override ${override}`;
    assert.equal((await webLogin(user)).status, status, label);
    const view = accessView(await User.findById(user._id).lean(), await Policy.findById("resident-web").lean());
    assert.equal(view.state, state, label);
    assert.equal(view.effective, status === 200, label);
    assert.equal(view.override, override, label);
  }

  await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: false } });
  const deactivated = await account("resident", "off", { residentWebAccessOverride: "allow", status: "deactivated" });
  assert.notEqual((await webLogin(deactivated)).status, 200, "an override never reactivates an account");
  assert.equal(accessView(deactivated.toObject(), { enabled: true }).state, "ineligible");

  const legacy = await account("resident", "legacy");
  await User.collection.updateOne({ _id: legacy._id }, { $unset: { residentWebAccessOverride: "" } });
  const legacyView = accessView(await User.findById(legacy._id).lean().then((row) => ({ ...row, residentWebAccessOverride: undefined })), { enabled: true });
  assert.equal(legacyView.state, "global_allowed", "a missing override means no override");

  const patchPath = (user) => `/admin/users/${user._id}/web-access`;
  const target = await account("resident", "target");
  const set = await h.request(patchPath(target), { method: "PATCH", headers, body: { override: "allow", revision: 0 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.access.state, "exception_allowed");
  assert.equal((await h.request(patchPath(target), { method: "PATCH", headers, body: { override: "block", revision: 0 } })).status, 409, "stale revision");
  const cleared = await h.request(patchPath(target), { method: "PATCH", headers, body: { override: null, revision: 1 } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.access.override, null);
  assert.equal(cleared.body.access.state, "global_blocked");
  for (const bad of [{ override: "maybe", revision: 2 }, { revision: 2 }, { enabled: true, revision: 2 }]) {
    assert.equal((await h.request(patchPath(target), { method: "PATCH", headers, body: bad })).status, 400, JSON.stringify(bad));
  }

  const selfService = await account("resident", "self", { residentWebAccessOverride: "allow" });
  const token = (await webLogin(selfService)).body.token;
  await h.request("/profile", { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: { residentWebAccessOverride: "block" } });
  assert.equal((await User.findById(selfService._id).lean()).residentWebAccessOverride, "allow", "residents cannot change their own override");

  await Policy.deleteMany({});
  assert.equal((await webLogin(selfService)).status, 503, "a missing policy fails closed even with allow");
  assert.equal(accessView(selfService.toObject(), null).state, "unavailable");
  console.log("Resident web override assertions passed");
};
run().then(() => h.teardown()).catch(async (error) => { console.error(error); await h.teardown(); process.exitCode = 1; });
