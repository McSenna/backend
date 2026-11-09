"use strict";
const assert = require("node:assert/strict");
const { startHarness, createUser } = require("./helpers/appointmentHarness");
let h;
async function run() {
  h = await startHarness();
  const { runPushCycle } = require("../../services/notification/pushWorker");
  const Device = require("../../models/PushDevice");
  const Notification = require("../../models/Notification");
  const Delivery = require("../../models/PushDelivery");
  const { user } = await createUser("resident");
  await Device.init(); await Delivery.init();
  const device = await Device.create({ user: user._id, deviceId: "550e8400-e29b-41d4-a716-446655440000", pushToken: "ExpoPushToken[synthetic]", platform: "android", sessionId: "test", tokenVersion: 0, expiresAt: new Date(Date.now() + 86400000) });
  const row = await Notification.create({ recipient: user._id, type: "appointment_confirmed", title: "Private detail", body: "Sensitive health detail" });
  let calls = 0;
  const fakeFetch = async (url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    if (url.endsWith("/send")) {
      assert.equal(payload.body, "Open MaslogCare to view your notification.");
      assert.equal(payload.channelId, "maslogcare-default");
      assert.equal(payload.data.destination, "notifications");
      assert.ok(!JSON.stringify(payload).includes("Sensitive"));
      return { ok: true, json: async () => ({ data: { status: "ok", id: "receipt-test" } }) };
    }
    return { ok: true, json: async () => ({ data: { "receipt-test": { status: "error", details: { error: "DeviceNotRegistered" } } } }) };
  };
  await runPushCycle({ fetchImpl: fakeFetch });
  await runPushCycle({ fetchImpl: fakeFetch });
  assert.equal(await Delivery.countDocuments({ notification: row._id }), 1);
  assert.equal(calls, 1, "accepted tickets must not be sent again");
  assert.equal((await Delivery.findOne()).state, "receipt");
  await Device.updateOne({ _id: device._id }, { $set: { pushToken: "ExpoPushToken[refreshed]" } });
  await Delivery.updateMany({}, { $set: { nextAt: new Date(0) } });
  await runPushCycle({ fetchImpl: fakeFetch });
  assert.equal((await Device.findById(device._id)).active, true, "old receipt must not deactivate a refreshed token");
  assert.equal((await Delivery.findOne()).state, "failed");
  // New notification after the installation moves accounts must not send old queued data.
  await Device.updateOne({ _id: device._id }, { $set: { active: true } });
  await Notification.create({ recipient: user._id, type: "announcement", title: "Test", body: "Test" });
  const temporary = async () => ({ ok: false, status: 503 });
  await runPushCycle({ fetchImpl: temporary });
  const retry = await Delivery.findOne({ state: "pending" });
  assert.ok(retry); assert.equal(retry.attempts, 1);
  const other = await createUser("resident");
  await Device.updateOne({ _id: device._id }, { $set: { user: other.user._id } });
  await Delivery.updateOne({ _id: retry._id }, { $set: { nextAt: new Date(0) } });
  const before = calls;
  await runPushCycle({ fetchImpl: fakeFetch });
  assert.equal(calls, before, "queued delivery is dropped after account switching");
  await require("../../models/User").collection.updateOne({ _id: user._id }, { $unset: { status: "" } });
  await Device.updateOne({ _id: device._id }, { $set: { user: user._id } });
  const legacy = await Notification.create({ recipient: user._id, type: "announcement", title: "Legacy", body: "Test" });
  await runPushCycle({ fetchImpl: fakeFetch });
  assert.equal((await Delivery.findOne({ notification: legacy._id })).state, "receipt", "verified legacy accounts follow the same eligibility as authentication");
  const rateLimited = await Notification.create({ recipient: user._id, type: "announcement", title: "Retry", body: "Test" });
  await runPushCycle({ fetchImpl: fakeFetch });
  await Delivery.updateOne({ notification: rateLimited._id }, { $set: { nextAt: new Date(0) } });
  await runPushCycle({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: {
    "receipt-test": { status: "error", details: { error: "MessageRateExceeded" } },
  } }) }) });
  assert.equal((await Delivery.findOne({ notification: rateLimited._id })).state, "pending");
  await Device.updateOne({ _id: device._id }, { $set: { pushToken: "ExpoPushToken[rotatedBeforeResend]" } });
  await Delivery.updateOne({ notification: rateLimited._id }, { $set: { nextAt: new Date(0) } });
  await runPushCycle({ fetchImpl: async () => ({ ok: true, json: async () => ({ data: {
    status: "error", details: { error: "DeviceNotRegistered" },
  } }) }) });
  assert.equal((await Device.findById(device._id)).active, false, "a direct-send rejection targets the token sent after rotation");
  console.log("Push tickets, receipts, privacy, retries, deduplication and account switching passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => h?.stop());
