"use strict";
process.env.EMAIL_PROVIDER = "mock";
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const Pending = require("../../models/register");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const { provisionDevice } = require("../../services/managedDevices");
const { issueSession } = require("../../services/sessionService");
const password = "SyntheticOnlyPassword123!";
const native = { "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.9.2" };
const browser = { Origin: "http://localhost:8081" };
const identity = (suffix) => ({ fullname: `Synthetic ${suffix}`, email: `${suffix}@example.test`, password, gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Synthetic address" });
const login = (user, extra = {}, headers = native) => {
  require("../../middleware/rateLimiter").clearLoginAttempts(user.email);
  return h.request("/login", { method: "POST", headers, body: { email: user.email, password, clientPlatform: "mobile", ...extra } });
};
const read = (token, headers = {}) => h.request("/profile", { headers: { Authorization: `Bearer ${token}`, ...headers } });
const credentialDenied = (response) => {
  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.equal(response.body.code, "DEVICE_CREDENTIAL_REQUIRED");
  assert.equal(response.body.token, undefined);
};
const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  const admin = await User.create({ ...identity("channel-admin"), role: "admin", status: "active", verified: true });
  const resident = await User.create({ ...identity("channel-resident"), role: "resident", status: "approved", verified: true });
  const other = await User.create({ ...identity("channel-other"), role: "resident", status: "approved", verified: true });
  const device = await provisionDevice(resident._id, admin._id);
  const otherDevice = await provisionDevice(other._id, admin._id);
  // Client claims never establish the mobile exemption, with or without browser signals.
  for (const headers of [native, { "X-Client-Platform": "mobile" }, {}]) {
    credentialDenied(await login(resident, {}, headers));
    credentialDenied(await login(resident, { deviceCredential: null }, headers));
  }
  for (const credential of ["invalid", otherDevice.credential, `${device.device.id}.${"0".repeat(64)}`])
    credentialDenied(await login(resident, { deviceCredential: credential }));
  const mobile = await login(resident, { deviceCredential: device.credential });
  assert.equal(mobile.status, 200, JSON.stringify(mobile.body));
  assert.equal(jwt.decode(mobile.body.token).deviceId, device.device.id);
  assert.equal((await read(mobile.body.token)).status, 200, "OFF leaves a credential-backed mobile session usable");
  assert.equal((await login(resident, { clientPlatform: "web" }, browser)).status, 403);
  const spoofedBrowser = await login(resident, { deviceCredential: device.credential }, browser);
  assert.equal(spoofedBrowser.body.code, "RESIDENT_WEB_ACCESS_DENIED", "browser requests are never issued a mobile session");
  assert.equal((await read(mobile.body.token, browser)).status, 403, "a mobile token cannot be used in a browser request");
  // Previously signed unbound mobile tokens cannot retain an exemption after rollout.
  for (const enabled of [false, true]) {
    await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled } });
    const unbound = jwt.sign({ userId: String(resident._id), role: "resident", platform: "mobile" }, process.env.JWT_SECRET);
    credentialDenied(await read(unbound, native));
    assert.equal((await read(mobile.body.token)).status, 200, `valid mobile session when global=${enabled}`);
  }
  assert.throws(() => issueSession(resident, "mobile"), (error) => error.code === "DEVICE_CREDENTIAL_REQUIRED");
  const web = issueSession(resident, "web").token;
  await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: false } });
  assert.equal((await read(web, { ...native, "X-Device-Credential": device.credential })).body.code, "RESIDENT_WEB_ACCESS_DENIED");
  await require("../../models/ManagedDevice").updateOne({ _id: device.device.id }, { $set: { revokedAt: new Date() } });
  credentialDenied(await read(mobile.body.token));
  credentialDenied(await login(resident, { deviceCredential: device.credential }));
  credentialDenied(await login(resident));
  assert.equal((await read(issueSession(admin, "mobile").token)).status, 200, "staff authentication is unchanged");
  // OTP registration may create the account but never grants an unbound mobile session.
  await Pending.create({ ...identity("channel-signup"), otp: "123456", otpExpires: new Date(Date.now() + 600000) });
  const signup = await h.request("/verify-otp", { method: "POST", headers: native, body: { email: "channel-signup@example.test", otp: "123456", clientPlatform: "mobile" } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.equal(signup.body.code, "DEVICE_CREDENTIAL_REQUIRED");
  assert.equal(signup.body.token, null);
  assert.ok(await User.exists({ email: "channel-signup@example.test" }), "registration is preserved without issuing a session");
  // Security credential changes must roll back when their required audit cannot be saved.
  const SystemLog = require("../../models/SystemLog");
  const ManagedDevice = require("../../models/ManagedDevice");
  const createLog = SystemLog.create;
  const beforeCount = await ManagedDevice.countDocuments({ residentId: other._id });
  let failedProvision, failedRevoke;
  SystemLog.create = async () => { throw new Error("synthetic device audit failure"); };
  try {
    const devicePath = `/admin/users/${other._id}/devices`;
    failedProvision = await h.request(devicePath, { method: "POST", headers: h.asAdmin(admin), body: {} });
    failedRevoke = await h.request(`${devicePath}/${otherDevice.device.id}`, { method: "DELETE", headers: h.asAdmin(admin) });
  } finally { SystemLog.create = createLog; }
  assert.equal(failedProvision.status, 500, "provisioning cannot succeed without its audit");
  assert.equal(failedRevoke.status, 500, "revocation cannot succeed without its audit");
  assert.equal(await ManagedDevice.countDocuments({ residentId: other._id }), beforeCount);
  assert.equal((await ManagedDevice.findById(otherDevice.device.id).lean()).revokedAt, null);
  console.log("Mobile channel security: credentials, legacy sessions, revocation, browser claims, web policy and OTP issuance passed");
};
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await h.teardown(); process.exit(process.exitCode || 0); });
