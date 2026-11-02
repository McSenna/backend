"use strict";
// Every person here is invented. Runs on the in-memory database, never the configured one.
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const SystemLog = require("../../models/SystemLog");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const { issueSession } = require("../../services/sessionService");

const ENV_KEY = "RESIDENT_WEB_ACCESS_ADMIN_ID";
const password = "SyntheticPassword123!";
const OFF_MESSAGE = "Your web access has been disabled. Please contact the administrator.";
const BROWSER = { Origin: "http://localhost:8081", "Sec-Fetch-Mode": "cors" };

let serial = 0;
const account = (role, extra = {}) => {
  serial += 1;
  return User.create({
    fullname: `Synthetic ${serial}`, email: `person${serial}@maslogcare.test`, password, role,
    status: role === "resident" ? "approved" : "active", verified: true, gender: "female",
    dateOfBirth: new Date("1990-01-01"), address: "Test address", ...extra,
  });
};
const bearer = (token, extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
const webToken = (user) => issueSession(user, "web").token;
const adminHeaders = (admin) => bearer(webToken(admin), BROWSER);
const individualPath = (user) => `/admin/users/${user._id}/web-access`;
const GLOBAL_PATH = "/admin/resident-web-access";
const setAccess = (admin, resident, body) =>
  h.request(individualPath(resident), { method: "PATCH", headers: adminHeaders(admin), body });
const setGlobal = (admin, body) =>
  h.request(GLOBAL_PATH, { method: "PATCH", headers: adminHeaders(admin), body });
const fresh = (user) => User.findById(user._id).lean();
const changeLogs = (resident) =>
  SystemLog.find({ action: "RESIDENT_WEB_ACCESS_CHANGED", resourceId: String(resident._id) }).sort({ createdAt: 1 }).lean();
const webLogin = (user, extra = {}) =>
  h.request("/login", { method: "POST", headers: BROWSER, body: { email: user.email, password, clientPlatform: "web", ...extra } });
const mobileLogin = async (user) =>
  h.request("/login", { method: "POST", headers: { "X-Client-Platform": "mobile" }, body: await require("./helpers/managedDeviceFixtures").managedLoginBody({ email: user.email, password, clientPlatform: "mobile" }) });
const protectedRead = (token, extra = {}) => h.request("/profile", { headers: bearer(token, extra) });

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();

  const kape = await account("admin", { fullname: "Kape Maslog" });
  const otherAdmin = await account("admin");
  const bhw = await account("bhw");
  process.env[ENV_KEY] = String(kape._id);

  // The real account has no explicit status field, only verified: true. It must still qualify.
  await User.collection.updateOne({ _id: kape._id }, { $unset: { status: "" } });
  const legacyShape = await account("resident");
  const legacyShapeResult = await setAccess(kape, legacyShape, { override: "block", revision: 0 });
  assert.equal(legacyShapeResult.status, 200, `an account with no status field: ${JSON.stringify(legacyShapeResult.body)}`);
  await User.updateOne({ _id: kape._id }, { $set: { status: "active" } });

  // The startup check reports a bad config without stopping the server.
  const { reportDesignatedAdmin } = require("../../services/residentWebAccess");
  delete process.env[ENV_KEY];
  await reportDesignatedAdmin();
  process.env[ENV_KEY] = String(bhw._id);
  await reportDesignatedAdmin();
  process.env[ENV_KEY] = String(kape._id);
  await reportDesignatedAdmin();

  // Authorization: the designated account, and only it.
  const resident = await account("resident");
  const enabled = await setAccess(kape, resident, { override: "allow", revision: 0 });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.access.status, "on");
  assert.equal(enabled.body.changed, true);
  const disabled = await setAccess(kape, resident, { override: "block", revision: 1, reason: "  Requested by the resident  " });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
  assert.equal(disabled.body.access.status, "off");
  assert.equal((await fresh(resident)).residentWebAccessOverride, "block", "the setting persists");

  await User.updateOne({ _id: kape._id }, { $set: { fullname: "Renamed Person", email: "renamed@maslogcare.test" } });
  const afterRename = await setAccess(kape, resident, { override: "allow", revision: 2 });
  assert.equal(afterRename.status, 200, "renaming keeps the permission");
  await User.updateOne({ _id: kape._id }, { $set: { fullname: "Kape Maslog", email: `person1@maslogcare.test` } });

  await User.updateOne({ _id: otherAdmin._id }, { $set: { fullname: "Kape Maslog" } });
  const stateBefore = await fresh(resident);
  const logsBefore = (await changeLogs(resident)).length;
  const denials = [
    await setAccess(otherAdmin, resident, { override: "block", revision: stateBefore.webAccessRevision }),
    await setGlobal(otherAdmin, { enabled: true, revision: 0 }),
    await h.request(GLOBAL_PATH, { headers: adminHeaders(otherAdmin) }),
    await h.request(individualPath(resident), { headers: adminHeaders(otherAdmin) }),
  ];
  denials.forEach((denied) => {
    assert.equal(denied.status, 403, "another admin named Kape Maslog is denied");
    assert.equal(denied.body.code, "RESIDENT_WEB_ACCESS_ADMIN_REQUIRED");
  });
  assert.equal((await fresh(resident)).residentWebAccessOverride, stateBefore.residentWebAccessOverride);
  assert.equal((await changeLogs(resident)).length, logsBefore, "a denied attempt is not a change");
  const deniedLog = await SystemLog.findOne({ action: "RESIDENT_WEB_ACCESS_DENIED", userId: otherAdmin._id }).lean();
  assert.ok(deniedLog, "the denied attempt is logged");
  assert.equal(deniedLog.success, false);
  assert.equal(JSON.stringify(deniedLog.metadata).includes(String(kape._id)), false, "the log does not reveal the designated id");

  const anonymous = await h.request(individualPath(resident), { method: "PATCH", headers: BROWSER, body: { override: "block", revision: 0 } });
  assert.equal(anonymous.status, 401);
  assert.equal((await h.request(GLOBAL_PATH, { method: "PATCH", headers: BROWSER, body: { enabled: true, revision: 0 } })).status, 401);
  const asResident = await account("resident", { residentWebAccessOverride: "allow" });
  assert.equal((await setAccess(asResident, asResident, { override: "allow", revision: 0 })).status, 403, "residents are denied");
  assert.equal((await setAccess(bhw, resident, { override: "block", revision: 0 })).status, 403, "staff are denied");

  // Forged identity and client-side permission values.
  const forgedBody = {
    override: "block", revision: (await fresh(resident)).webAccessRevision, adminId: String(kape._id), actorId: String(kape._id),
    userId: String(kape._id), designated: true, permissions: { manageResidentWebAccess: true },
  };
  const forgedHeaders = { ...adminHeaders(otherAdmin), "X-Admin-Id": String(kape._id), "X-User-Id": String(kape._id) };
  assert.equal((await h.request(individualPath(resident), { method: "PATCH", headers: forgedHeaders, body: forgedBody })).status, 403, "request-supplied ids grant nothing");
  const claimToken = jwt.sign({ userId: String(otherAdmin._id), role: "admin", platform: "web", designated: true, permissions: { manageResidentWebAccess: true } }, process.env.JWT_SECRET);
  assert.equal((await h.request(individualPath(resident), { method: "PATCH", headers: bearer(claimToken, BROWSER), body: forgedBody })).status, 403, "extra token claims grant nothing");
  const conflictingIdentity = jwt.sign({ userId: String(otherAdmin._id), _id: String(kape._id), role: "admin", platform: "web" }, process.env.JWT_SECRET);
  assert.equal((await h.request(individualPath(resident), { method: "PATCH", headers: bearer(conflictingIdentity, BROWSER), body: forgedBody })).status, 403, "an extra identity claim cannot override the database-loaded actor");
  const wrongSecret = jwt.sign({ userId: String(kape._id), role: "admin", platform: "web" }, "not-the-signing-secret-not-the-signing-secret");
  assert.equal((await h.request(individualPath(resident), { method: "PATCH", headers: bearer(wrongSecret, BROWSER), body: forgedBody })).status, 401, "a forged token for the designated id is refused");

  // The audit actor comes from the verified session, not the body.
  const actorTarget = await account("resident");
  const spoofedActor = await setAccess(kape, actorTarget, { override: "allow", revision: 0, actorId: String(otherAdmin._id), userId: String(otherAdmin._id) });
  assert.equal(spoofedActor.status, 200);
  assert.equal(String((await changeLogs(actorTarget))[0].userId), String(kape._id));

  // Scope: residents only, and no more than a plain admin can already reach.
  assert.equal((await setAccess(kape, otherAdmin, { override: "allow", revision: 0 })).status, 404, "staff are not targets");
  assert.equal((await setAccess(kape, { _id: new mongoose.Types.ObjectId() }, { override: "allow", revision: 0 })).status, 404);
  assert.equal((await setAccess(kape, { _id: "not-an-id" }, { override: "allow", revision: 0 })).status, 400);

  // Permission flag shown to the client is computed by the server.
  const flagOf = async (user) => (await webLogin(user)).body.user?.permissions?.manageResidentWebAccess;
  assert.equal(await flagOf(kape), true);
  assert.equal(await flagOf(otherAdmin), false);
  assert.equal(JSON.stringify((await webLogin(otherAdmin)).body).includes(String(kape._id)), false, "other admins are not told the designated id");

  // Fail closed on any missing or wrong configuration.
  const failTarget = await account("resident");
  for (const value of [undefined, "", "   ", "not-an-id", "ADM-2026-5BE2", "Kape Maslog", String(new mongoose.Types.ObjectId()), String(otherAdmin._id).slice(0, 23)]) {
    if (value === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = value;
    const label = `config ${JSON.stringify(value)}`;
    assert.equal((await setAccess(kape, failTarget, { override: "allow", revision: 0 })).status, 403, label);
    assert.equal((await setGlobal(kape, { enabled: true, revision: 0 })).status, 403, label);
    assert.equal(await flagOf(kape), false, label);
  }
  process.env[ENV_KEY] = String(failTarget._id);
  assert.equal((await setAccess(failTarget, failTarget, { override: "allow", revision: 0 })).status, 403, "a resident id in the config grants nothing");
  process.env[ENV_KEY] = String(bhw._id);
  assert.equal((await setAccess(bhw, failTarget, { override: "allow", revision: 0 })).status, 403, "a non-admin id in the config grants nothing");
  process.env[ENV_KEY] = String(kape._id);
  await User.updateOne({ _id: kape._id }, { $set: { role: "doctor" } });
  assert.equal((await setAccess(kape, failTarget, { override: "allow", revision: 0 })).status, 403, "losing the admin role ends the permission");
  await User.updateOne({ _id: kape._id }, { $set: { role: "admin", status: "deactivated" } });
  assert.equal((await setAccess(kape, failTarget, { override: "allow", revision: 0 })).status, 401, "a deactivated account cannot act");
  await User.updateOne({ _id: kape._id }, { $set: { status: "active" } });
  assert.equal((await fresh(failTarget)).residentWebAccessOverride, null, "none of those attempts changed the resident");

  // Resident behaviour on web and mobile.
  const person = await account("resident", { residentWebAccessOverride: "allow", webAccessRevision: 1 });
  const web = await webLogin(person);
  assert.equal(web.status, 200, JSON.stringify(web.body));
  const mobile = await mobileLogin(person);
  assert.equal(mobile.status, 200, JSON.stringify(mobile.body));
  const legacyToken = jwt.sign({ userId: String(person._id), role: "resident" }, process.env.JWT_SECRET);
  assert.equal((await protectedRead(web.body.token, BROWSER)).status, 200);

  assert.equal((await setAccess(kape, person, { override: "block", revision: 1 })).status, 200);
  const blockedLogin = await webLogin(person);
  assert.equal(blockedLogin.status, 403, "OFF blocks a new web session");
  assert.equal(blockedLogin.body.code, "RESIDENT_WEB_ACCESS_DENIED");
  assert.equal(blockedLogin.body.message, OFF_MESSAGE);
  assert.equal(blockedLogin.body.token, undefined, "no token is issued");
  const blockedRead = await protectedRead(web.body.token, BROWSER);
  assert.equal(blockedRead.status, 403, "OFF stops an existing web session on its next request");
  assert.equal(blockedRead.body.message, OFF_MESSAGE);
  for (const path of ["/appointments/me", "/notifications", "/session/access"]) {
    assert.equal((await h.request(path, { headers: bearer(web.body.token, BROWSER) })).status, 403, `direct request to ${path}`);
  }

  // Mobile keeps working.
  assert.equal((await protectedRead(mobile.body.token, { "X-Client-Platform": "mobile" })).status, 200, "an existing mobile session is unaffected");
  const newMobile = await mobileLogin(person);
  assert.equal(newMobile.status, 200, "a new mobile sign-in is unaffected");
  assert.equal((await protectedRead(newMobile.body.token, { "X-Client-Platform": "mobile" })).status, 200);

  // A web user cannot claim to be mobile.
  assert.equal((await webLogin(person, { clientPlatform: "mobile" })).status, 403, "a browser login claiming mobile in the body");
  assert.equal((await h.request("/login", { method: "POST", headers: { ...BROWSER, "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.9.2" }, body: { email: person.email, password } })).status, 403, "a browser login claiming mobile by header and user agent");
  assert.equal((await protectedRead(web.body.token, { "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.9.2" })).status, 403, "a web token stays web whatever the headers say");
  assert.equal((await h.request("/profile?clientPlatform=mobile", { headers: bearer(web.body.token) })).status, 403, "a web token stays web whatever the query says");
  assert.equal((await protectedRead(legacyToken, { "X-Client-Platform": "mobile" })).status, 403, "a token with no platform claim is treated as web");
  assert.equal((await protectedRead(mobile.body.token, BROWSER)).status, 403, "a mobile token is refused from a browser");
  const forgedMobile = jwt.sign({ userId: String(person._id), role: "resident", platform: "mobile" }, "not-the-signing-secret-not-the-signing-secret");
  assert.equal((await protectedRead(forgedMobile, { "X-Client-Platform": "mobile" })).status, 401, "a self-made mobile token is refused");

  // ON restores the same session, and never overrides other restrictions.
  assert.equal((await setAccess(kape, person, { override: "allow", revision: 2 })).status, 200);
  assert.equal((await protectedRead(web.body.token, BROWSER)).status, 200, "ON restores the unexpired session");
  assert.equal((await webLogin(person)).status, 200, "ON restores sign-in");
  for (const restricted of [{ status: "deactivated" }, { status: "suspended" }, { status: "pending", verified: false }]) {
    const held = await account("resident", restricted);
    const turnedOn = await setAccess(kape, held, { override: "allow", revision: 0 });
    assert.equal(turnedOn.status, 200);
    assert.equal(turnedOn.body.access.status, "off", `ON does not bypass ${JSON.stringify(restricted)}`);
    assert.notEqual((await webLogin(held)).status, 200, `sign-in stays refused for ${JSON.stringify(restricted)}`);
    const after = await fresh(held);
    assert.equal(after.status, restricted.status, "the account status is not touched");
  }

  // Audit contents, on a real change.
  const audited = await account("resident");
  await setAccess(kape, audited, { override: "allow", revision: 0, reason: "  Needs the portal  " });
  await setAccess(kape, audited, { override: "block", revision: 1 });
  const [first, second, ...rest] = await changeLogs(audited);
  assert.equal(rest.length, 0);
  assert.equal(String(first.userId), String(kape._id), "the actor is the immutable id");
  assert.equal(first.resourceId, String(audited._id));
  assert.equal(first.metadata.residentId, String(audited._id));
  assert.equal(first.metadata.previousStatus, "off");
  assert.equal(first.metadata.newStatus, "on");
  assert.equal(first.metadata.reason, "Needs the portal");
  assert.ok(first.createdAt instanceof Date);
  assert.equal(second.metadata.previousStatus, "on");
  assert.equal(second.metadata.newStatus, "off");
  assert.equal(second.metadata.reason, null);

  // Reason validation.
  for (const reason of [42, { a: 1 }, "x".repeat(301)]) {
    assert.equal((await setAccess(kape, audited, { override: "allow", revision: 2, reason })).status, 400, `reason ${JSON.stringify(reason)?.slice(0, 20)}`);
  }

  // Repeating a request changes nothing and records nothing.
  const repeat = await setAccess(kape, audited, { override: "block", revision: 2 });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.changed, false);
  assert.equal((await fresh(audited)).webAccessRevision, 2, "the revision does not move");
  assert.equal((await setAccess(kape, audited, { override: "block", revision: 0 })).body.changed, false, "a stale repeat is still safe");
  assert.equal((await changeLogs(audited)).length, 2);

  // Stale interface state and concurrency.
  assert.equal((await setAccess(kape, audited, { override: "allow", revision: 0 })).status, 409, "a stale change is refused");
  const racer = await account("resident");
  const race = await Promise.all([
    setAccess(kape, racer, { override: "allow", revision: 0 }),
    setAccess(kape, racer, { override: "block", revision: 0 }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409], JSON.stringify(race.map((r) => r.body)));
  const raced = await fresh(racer);
  assert.equal(raced.webAccessRevision, 1);
  const raceLogs = await changeLogs(racer);
  assert.equal(raceLogs.length, 1);
  assert.equal(raceLogs[0].metadata.newOverride, raced.residentWebAccessOverride, "the audit matches the winner");
  const doubler = await account("resident");
  const doubled = await Promise.all([1, 2, 3].map(() => setAccess(kape, doubler, { override: "allow", revision: 0 })));
  assert.equal(doubled.filter((r) => r.body.changed === true).length, 1, "a double submit applies once");
  assert.equal((await changeLogs(doubler)).length, 1);

  // The change and its audit commit together.
  const atomic = await account("resident");
  const realCreate = SystemLog.create;
  SystemLog.create = async () => { throw new Error("simulated audit failure"); };
  const failedAudit = await setAccess(kape, atomic, { override: "allow", revision: 0 });
  const policyBefore = await Policy.findById("resident-web").lean();
  const failedGlobalAudit = await setGlobal(kape, { enabled: !policyBefore.enabled, revision: policyBefore.revision });
  SystemLog.create = realCreate;
  assert.equal(failedAudit.status, 500);
  const untouched = await fresh(atomic);
  assert.equal(untouched.residentWebAccessOverride, null, "no audit, no change");
  assert.equal(untouched.webAccessRevision, 0);
  assert.equal(failedGlobalAudit.status, 500);
  assert.equal((await Policy.findById("resident-web").lean()).enabled, policyBefore.enabled, "no audit, no global change");

  // The global switch: same permission, audited with every resident it changes.
  await User.updateMany({ role: "resident" }, { $set: { residentWebAccessOverride: "block" } });
  const followsGlobal = await account("resident");
  const pinnedOn = await account("resident", { residentWebAccessOverride: "allow" });
  const inactive = await account("resident", { status: "deactivated" });
  const policy = await Policy.findById("resident-web").lean();
  assert.equal(policy.enabled, false);
  const turnedOn = await setGlobal(kape, { enabled: true, revision: policy.revision, reason: "Portal opened" });
  assert.equal(turnedOn.status, 200, JSON.stringify(turnedOn.body));
  assert.equal(turnedOn.body.changed, true);
  const policyLog = await SystemLog.findOne({ action: "RESIDENT_WEB_POLICY_CHANGED" }).sort({ createdAt: -1 }).lean();
  assert.equal(String(policyLog.userId), String(kape._id));
  assert.equal(policyLog.metadata.previousStatus, "off");
  assert.equal(policyLog.metadata.newStatus, "on");
  assert.equal(policyLog.metadata.reason, "Portal opened");
  assert.deepEqual(policyLog.metadata.affectedResidentIds, [String(followsGlobal._id)], "only residents whose status really changed");
  assert.ok(!policyLog.metadata.affectedResidentIds.includes(String(pinnedOn._id)));
  assert.ok(!policyLog.metadata.affectedResidentIds.includes(String(inactive._id)));
  const logCount = await SystemLog.countDocuments({ action: "RESIDENT_WEB_POLICY_CHANGED" });
  const samePolicy = await setGlobal(kape, { enabled: true, revision: turnedOn.body.policy.revision });
  assert.equal(samePolicy.body.changed, false);
  assert.equal(await SystemLog.countDocuments({ action: "RESIDENT_WEB_POLICY_CHANGED" }), logCount);
  assert.equal(samePolicy.body.policy.revision, turnedOn.body.policy.revision);
  assert.equal((await setGlobal(kape, { enabled: false, revision: 0 })).status, 409, "a stale global change is refused");
  await setGlobal(kape, { enabled: false, revision: turnedOn.body.policy.revision });

  // Rollout: a broken config changes nobody's existing access, only who may change it.
  const existing = await account("resident", { residentWebAccessOverride: "allow" });
  delete process.env[ENV_KEY];
  assert.equal((await webLogin(existing)).status, 200, "existing individual settings keep working");
  assert.equal((await webLogin(followsGlobal)).status, 403, "the global setting keeps working");
  process.env[ENV_KEY] = String(kape._id);

  // Other admin features are unchanged, and status stays visible read-only.
  const list = await h.request("/users?page=1&pageSize=5&tab=all", { headers: adminHeaders(otherAdmin) });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal((await h.request(`/admin/users/${existing._id}/devices`, { headers: adminHeaders(otherAdmin) })).status, 200, "device management stays with every admin");
  assert.equal((await h.request("/system-logs", { headers: adminHeaders(otherAdmin) })).status, 200, "the system log stays with every admin");

  // Omitting browser signals and claiming mobile never replaces device proof.
  const nonBrowser = await h.request("/login", { method: "POST", headers: { "X-Client-Platform": "mobile" }, body: { email: person.email, password, clientPlatform: "mobile" } });
  assert.equal(nonBrowser.status, 403);
  assert.equal(nonBrowser.body.code, "DEVICE_CREDENTIAL_REQUIRED");
  assert.equal(nonBrowser.body.token, undefined);

  console.log("residentWebAccessDesignatedAdmin: all checks passed");
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await h.teardown(); process.exit(process.exitCode || 0); });
