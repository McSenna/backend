"use strict";

// Boots the real server with Socket.IO and the change feed on an in-memory
// replica set, then checks who receives what. Every account is invented.
process.env.TZ = "Asia/Manila";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";

const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { io: connect } = require("socket.io-client");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const { startRealtime, stopRealtime } = require("../../realtime");
const User = require("../../models/User");
const Appointment = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const Notification = require("../../models/Notification");
const InventoryItem = require("../../models/InventoryItem");
const { createChecker } = require("./helpers/appointmentHarness");
const { createAccount, waitFor, expectSilence, nextConnect } = require("./helpers/realtimeHarness");

const run = async (baseUrl, check) => {
  const open = (token, extra = {}) =>
    connect(baseUrl, { transports: ["websocket"], reconnection: false, auth: { token, platform: "mobile" }, ...extra });

  const refused = await nextConnect(open(undefined));
  check("a socket without a token is refused", refused.error?.data?.code === "AUTHENTICATION_REQUIRED");
  const forged = await nextConnect(open("not-a-token"));
  check("a forged token is refused", forged.error?.data?.code === "INVALID_TOKEN");

  const [doctor, midwife, admin, residentA, residentB] = await Promise.all(
    ["doctor", "midwife", "admin", "resident", "resident"].map(createAccount)
  );

  const fromBrowser = await nextConnect(open(residentA.token, { extraHeaders: { "sec-fetch-mode": "websocket" } }));
  check("a mobile session opened from a browser is refused", fromBrowser.error?.data?.code === "PLATFORM_CONTEXT_MISMATCH");

  const host = new URL(baseUrl).host;
  const sockets = {};
  for (const [name, account] of Object.entries({ doctor, midwife, admin, residentA, residentB })) {
    // React Native's Android WebSocket always sends Origin set to the API host.
    const socket = open(account.token, { extraHeaders: { origin: `http://${host}` } });
    const result = await nextConnect(socket);
    check(`${name} connects with a React Native style Origin`, result.connected, result.error?.data?.code);
    sockets[name] = socket;
  }

  const visitEvents = Promise.all([
    waitFor(sockets.doctor, "appointment:created"),
    waitFor(sockets.admin, "appointment:created"),
    waitFor(sockets.residentA, "myAppointment:created"),
  ]);
  const visit = await Appointment.create({
    resident: residentA.user._id,
    consultationType: "general_checkup",
    status: "confirmed",
    ageTier: 4,
    prioritySortKey: 4,
    description: "Test visit",
  });
  const [staffEvent, adminEvent, ownEvent] = await visitEvents;
  check("the doctor's queue receives a doctor-service appointment", staffEvent?._id === String(visit._id));
  check("the staff row is populated like GET /appointments", staffEvent?.resident?.fullname === residentA.user.fullname && staffEvent?.queueRole === "doctor");
  check("admins receive every service", adminEvent?._id === String(visit._id));
  check("the resident receives their own appointment", ownEvent?._id === String(visit._id));
  check("the midwife does not receive a doctor-service appointment", await expectSilence(sockets.midwife, "appointment:created"));
  check("another resident receives nothing", await expectSilence(sockets.residentB, "myAppointment:created"));

  const updateEvent = waitFor(sockets.residentA, "myAppointment:updated");
  await Appointment.updateOne({ _id: visit._id }, { $set: { status: "cancelled" } });
  const updated = await updateEvent;
  check("a bulk-style update is published after commit", updated?.status === "cancelled");

  const recordEvents = Promise.all([
    waitFor(sockets.residentA, "myMedicalRecord:created"),
    waitFor(sockets.doctor, "medicalRecord:created"),
  ]);
  await MedicalRecord.create({
    resident: residentA.user._id,
    appointment: visit._id,
    provider: doctor.user._id,
    providerRole: "doctor",
    serviceType: "general_checkup",
    assessment: "Test assessment",
    notes: "Staff-only test note",
    completedAt: new Date(),
  });
  const [ownRecord, staffRecord] = await recordEvents;
  check("the resident receives their record without staff-only notes", Boolean(ownRecord) && !("notes" in ownRecord));
  check("the owning service receives the masterlist row", staffRecord?.serviceType === "general_checkup");
  check("another service's staff receive no record", await expectSilence(sockets.midwife, "medicalRecord:created"));

  const alertEvent = waitFor(sockets.residentB, "notification:created");
  await Notification.create({ recipient: residentB.user._id, type: "system", title: "Test", body: "Test body" });
  check("a notification reaches only its recipient", Boolean(await alertEvent));
  check("other accounts get no notification", await expectSilence(sockets.residentA, "notification:created"));

  const stockEvent = waitFor(sockets.midwife, "inventoryItem:created");
  await InventoryItem.create({ name: "Test item", category: "Medicine", unit: "box", createdBy: admin.user._id });
  check("staff receive inventory changes", Boolean(await stockEvent));
  check("residents receive no inventory changes", await expectSilence(sockets.residentA, "inventoryItem:created"));

  const kicked = waitFor(sockets.residentB, "disconnect");
  await User.updateOne({ _id: residentB.user._id }, { $set: { status: "suspended" } });
  check("suspending an account drops its sockets", (await kicked) === "io server disconnect");
  const retry = await nextConnect(open(residentB.token));
  check("a suspended account cannot reconnect", retry.error?.data?.code === "ACCOUNT_DISABLED");

  const shortToken = jwt.sign({ userId: String(midwife.user._id), role: "midwife", platform: "mobile" }, process.env.JWT_SECRET, { expiresIn: 2 });
  const shortLived = open(shortToken);
  await nextConnect(shortLived);
  check("a socket is dropped when its token expires", (await waitFor(shortLived, "disconnect", 4000)) === "io server disconnect");

  Object.values(sockets).forEach((socket) => socket.close());
};

const main = async () => {
  const { check, tally } = createChecker();
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([User, Appointment, MedicalRecord, Notification, InventoryItem].map((model) => model.createCollection()));

  const server = http.createServer(createApp());
  startRealtime(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`, check);
  } catch (error) {
    check("realtime suite ran to the end", false, error?.message);
  }

  await stopRealtime();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await replSet.stop();
  console.log(`\nResults: ${tally.passed} passed, ${tally.failed} failed.`);
  process.exit(tally.failed > 0 ? 1 : 0);
};

main();
