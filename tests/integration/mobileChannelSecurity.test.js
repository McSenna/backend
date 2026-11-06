"use strict";
process.env.EMAIL_PROVIDER = "mock";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { once } = require("node:events");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { io: connect } = require("socket.io-client");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const Pending = require("../../models/register");
const { createApp } = require("../../app");
const { attachRealtime } = require("../../realtime/socketServer");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const { issueSession } = require("../../services/sessionService");
const password = "SyntheticOnlyPassword123!";
const native = { "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.9.2" };
const browser = { Origin: "http://localhost:8081" };
const identity = (suffix) => ({ fullname: `Synthetic ${suffix}`, email: `${suffix}@example.test`, password, gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Synthetic address" });
const login = (user, extra = {}, headers = native) => {
  require("../../middleware/rateLimiter").clearLoginAttempts(user.email);
  return h.request("/login", { method: "POST", headers, body: { email: user.email, password, clientPlatform: "mobile", ...extra } });
};
const read = (token, headers = native) => h.request("/profile", { headers: { Authorization: `Bearer ${token}`, ...headers } });
const signedIn = (response, label) => {
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(response.body)}`);
  assert.equal(typeof response.body.token, "string", label);
  const claims = jwt.decode(response.body.token);
  assert.equal(claims.platform, "mobile", label);
  assert.equal(claims.deviceId, undefined, `${label}: sessions no longer carry a device binding`);
  return response.body.token;
};
// Device records written by the removed provisioning feature, inserted the way they sit in a database today.
const legacyDevice = async (resident, revokedAt = null) => {
  const _id = new mongoose.Types.ObjectId();
  const secret = crypto.randomBytes(32).toString("hex");
  await mongoose.connection.collection("manageddevices").insertOne({
    _id, residentId: resident._id, createdBy: resident._id, revokedAt,
    credentialHash: crypto.createHash("sha256").update(secret).digest("hex"),
    createdAt: new Date(), updatedAt: new Date(),
  });
  return { id: String(_id), credential: `${_id}.${secret}` };
};
const legacyToken = (resident, deviceId) =>
  jwt.sign({ userId: String(resident._id), email: resident.email, role: "resident", platform: "mobile", sessionId: crypto.randomUUID(), deviceId, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: "7d" });

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  const admin = await User.create({ ...identity("channel-admin"), role: "admin", status: "active", verified: true });
  const resident = await User.create({ ...identity("channel-resident"), role: "resident", status: "approved", verified: true });
  const other = await User.create({ ...identity("channel-other"), role: "resident", status: "approved", verified: true });

  // Fresh install: email and password alone open a mobile session, with or without the old field.
  const fresh = signedIn(await login(resident), "fresh install");
  assert.equal((await read(fresh)).status, 200, "a fresh mobile session can read");
  signedIn(await login(resident, {}, { "X-Client-Platform": "mobile" }), "native without a user agent");
  for (const deviceCredential of [null, "", "not-a-credential", 42])
    signedIn(await login(resident, { deviceCredential }), `older app sending ${JSON.stringify(deviceCredential)}`);

  // Residents tied to active, revoked, or another resident's provisioning records sign in normally.
  const active = await legacyDevice(resident);
  const revoked = await legacyDevice(resident, new Date());
  const othersDevice = await legacyDevice(other);
  for (const [label, credential] of [["active", active.credential], ["revoked", revoked.credential], ["another resident's", othersDevice.credential], ["forged", `${active.id}.${"0".repeat(64)}`]])
    signedIn(await login(resident, { deviceCredential: credential }), `${label} credential`);
  signedIn(await login(other), "resident with records but no saved credential");

  // Upgrading installs keep their session: a token bound to an active device still works.
  assert.equal((await read(legacyToken(resident, active.id))).status, 200, "an upgraded install keeps its signed-in session");
  assert.equal((await read(legacyToken(resident, null))).status, 200, "an unbound mobile session is a normal mobile session");
  // A session an administrator already revoked stays ended; the resident just signs in again.
  const ended = await read(legacyToken(resident, revoked.id));
  assert.equal(ended.status, 401, JSON.stringify(ended.body));
  assert.equal(ended.body.code, "INVALID_TOKEN", "installed apps sign out on this code");
  signedIn(await login(resident), "sign-in after a revoked device session");

  // Password, account status and web rules are unchanged.
  const wrong = await login(resident, { password: "WrongPassword123!" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, "INVALID_CREDENTIALS");
  assert.equal(wrong.body.token, undefined);
  const unknown = await h.request("/login", { method: "POST", headers: native, body: { email: "nobody@example.test", password, clientPlatform: "mobile" } });
  assert.equal(unknown.status, 401);
  for (const [status, code] of [["suspended", "ACCOUNT_SUSPENDED"], ["deactivated", "ACCOUNT_DEACTIVATED"], ["rejected", "REGISTRATION_REJECTED"]]) {
    await User.updateOne({ _id: other._id }, { $set: { status } });
    const refused = await login(other);
    assert.equal(refused.status, 403, `${status}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.code, code, status);
    assert.equal(refused.body.token, undefined, status);
  }
  const otherToken = legacyToken(other, null);
  await User.updateOne({ _id: other._id }, { $set: { status: "suspended" } });
  assert.equal((await read(otherToken)).status, 401, "a disabled account's existing mobile session is refused");
  await User.updateOne({ _id: other._id }, { $set: { status: "approved" } });

  // A browser is always web, whatever it claims, so the resident web policy still applies.
  await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: false } });
  const spoofed = await login(resident, { deviceCredential: active.credential }, browser);
  assert.equal(spoofed.status, 403);
  assert.equal(spoofed.body.code, "RESIDENT_WEB_ACCESS_DENIED", "browser requests are never issued a mobile session");
  assert.equal((await read(fresh, browser)).status, 403, "a mobile token cannot be used in a browser request");
  assert.equal((await read(fresh)).status, 200, "mobile sessions are unaffected by the web switch");
  const web = issueSession(resident, "web").token;
  assert.equal((await read(web, {})).body.code, "RESIDENT_WEB_ACCESS_DENIED", "a web session still follows the web policy");
  await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: true } });

  // Sessions issue without a device and staff are unchanged.
  const issued = issueSession(resident, "mobile");
  assert.equal(jwt.decode(issued.token).deviceId, undefined);
  assert.equal((await read(issued.token)).status, 200);
  assert.equal((await read(issueSession(admin, "mobile").token)).status, 200, "staff authentication is unchanged");

  // Logout, sign-in again and session restoration on a live socket.
  const relogin = signedIn(await login(resident), "sign-in before logout");
  assert.equal((await h.request("/logout", { method: "POST", headers: { ...native, Authorization: `Bearer ${relogin}` }, body: {} })).status, 200);
  const restored = signedIn(await login(resident), "sign-in after logout");
  const server = http.createServer(createApp()); attachRealtime(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const socket = connect(`http://127.0.0.1:${server.address().port}`, { transports: ["websocket"], auth: { token: restored }, extraHeaders: native, reconnection: false, autoConnect: false });
    const ready = once(socket, "connect"); socket.connect(); await ready;
    assert.equal(socket.connected, true, "a restored mobile session opens its live connection");
    socket.close();
  } finally { await new Promise((resolve) => server.close(resolve)); }

  // OTP registration on the mobile app now finishes signed in.
  await Pending.create({ ...identity("channel-signup"), otp: "123456", otpExpires: new Date(Date.now() + 600000) });
  const signup = await h.request("/verify-otp", { method: "POST", headers: native, body: { email: "channel-signup@example.test", otp: "123456", clientPlatform: "mobile", deviceCredential: null } });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  assert.equal(typeof signup.body.token, "string", "registration on mobile issues a session");
  assert.equal(signup.body.code, undefined);
  assert.equal((await read(signup.body.token)).status, 200);

  // The provisioning endpoints are gone.
  const devicePath = `/admin/users/${resident._id}/devices`;
  for (const [method, path] of [["GET", devicePath], ["POST", devicePath], ["DELETE", `${devicePath}/${active.id}`]])
    assert.equal((await h.request(path, { method, headers: h.asAdmin(admin), body: method === "POST" ? {} : undefined })).status, 404, `${method} ${path}`);
  assert.equal(await mongoose.connection.collection("manageddevices").countDocuments({ residentId: resident._id }), 2, "old records are left in place");
  console.log("Mobile channel security: password-only mobile sign-in, upgrades, revoked sessions, account rules, browser claims, logout, sockets and OTP issuance passed");
};
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await h.teardown(); process.exit(process.exitCode || 0); });
