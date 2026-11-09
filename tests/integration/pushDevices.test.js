"use strict";
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { startHarness, createUser } = require("./helpers/appointmentHarness");
let harness;
async function run() {
  harness = await startHarness();
  const a = await createUser("resident");
  const b = await createUser("resident");
  const tokenFor = (user, sessionId) => jwt.sign({ userId: String(user._id), role: "resident", platform: "mobile", sessionId }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const ta = tokenFor(a.user, "a"); const tb = tokenFor(b.user, "b");
  const body = { deviceId: "550e8400-e29b-41d4-a716-446655440000", pushToken: "ExponentPushToken[syntheticDeviceOne]", platform: "android" };
  const post = (token, payload = body) => harness.request("/notifications/device", { method: "POST", token, body: payload });
  assert.equal((await post()).status, 401);
  assert.equal((await post(ta)).status, 200);
  const Device = require("../../models/PushDevice");
  await Promise.all([post(ta), post(ta)]);
  assert.equal(await Device.countDocuments(), 1, "repeat registration must be idempotent");
  assert.equal((await post(ta, { ...body, userId: String(b.user._id) })).status, 400);
  assert.equal((await post(ta, { ...body, pushToken: "not-an-expo-token" })).status, 400);
  assert.equal((await post(ta, { ...body, pushToken: [body.pushToken] })).status, 400);
  await post(ta, { ...body, deviceId: "550e8400-e29b-41d4-a716-446655440001", pushToken: "ExpoPushToken[syntheticDeviceTwo]" });
  assert.equal(await Device.countDocuments({ user: a.user._id, active: true }), 2);
  await post(tb, { ...body, pushToken: "ExpoPushToken[rotatedDeviceOne]" });
  assert.equal(await Device.countDocuments({ user: a.user._id, active: true }), 1, "account switching transfers only this installation");
  // Exercise the service with the authenticated old owner; HTTP registration above covers middleware.
  const { unregister } = require("../../services/notification/pushDevices");
  await unregister({ body: { deviceId: body.deviceId }, user: { userId: String(a.user._id), exp: Math.floor(Date.now() / 1000) + 3600 }, auth: { platform: "mobile", sessionId: "a" } });
  assert.equal(await Device.countDocuments({ user: b.user._id, active: true }), 1, "old account cannot remove new owner");
  await harness.request("/logout", { method: "POST", token: tb });
  assert.equal(await Device.countDocuments({ user: b.user._id, active: true }), 0, "server logout deactivates session push association");
  assert.equal(await Device.countDocuments({ user: a.user._id, active: true }), 1, "other devices remain registered");
  console.log("Push device registration, ownership, rotation, multiple devices and logout passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => harness?.stop());
