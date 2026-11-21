"use strict";

// Marking one alert read or unread: only its own recipient may, the unread
// count comes back with it, and repeating a press is harmless.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const assert = require("node:assert/strict");
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const User = require("../../models/User");
const Notification = require("../../models/Notification");

let baseUrl;

const request = (path, { method = "GET", headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(new URL(`${baseUrl}${path}`), { method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on("error", reject);
    req.end();
  });

let seq = 0;
const makeUser = (role) =>
  User.create({
    fullname: `Test ${role} ${++seq}`,
    email: `${role}.${seq}@maslogcare.test`,
    password: "InitialPass123!",
    role,
    verified: true,
    status: "approved",
    phone: "09171234567",
    gender: "female",
    dateOfBirth: new Date("1990-01-01"),
    address: "Purok 1, Maslog",
  });

const headersFor = (user) => ({
  Authorization: `Bearer ${jwt.sign({ userId: String(user._id), role: user.role, platform: "web" }, process.env.JWT_SECRET, { expiresIn: "1h" })}`,
  "X-Client-Platform": "web",
});

const alert = (recipient, extra = {}) =>
  Notification.create({ recipient: recipient._id, type: "inventory_low_stock", title: "Test alert", body: "Test body", ...extra });

(async () => {
  let mongod;
  let server;
  try {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;

    const admin = await makeUser("admin");
    const other = await makeUser("admin");
    const read = await alert(admin, { isRead: true, readAt: new Date() });
    await alert(admin);

    const unread = await request(`/notifications/${read._id}/unread`, { method: "PATCH", headers: headersFor(admin) });
    assert.equal(unread.status, 200);
    assert.equal(unread.body.updated, true);
    assert.equal(unread.body.unreadCount, 2);
    const stored = await Notification.findById(read._id).lean();
    assert.equal(stored.isRead, false);
    assert.equal(stored.readAt, null);

    // Pressing it again changes nothing and is not an error.
    const again = await request(`/notifications/${read._id}/unread`, { method: "PATCH", headers: headersFor(admin) });
    assert.equal(again.status, 200);
    assert.equal(again.body.updated, false);
    assert.equal(again.body.unreadCount, 2);

    const back = await request(`/notifications/${read._id}/read`, { method: "PATCH", headers: headersFor(admin) });
    assert.equal(back.body.unreadCount, 1);
    assert.ok((await Notification.findById(read._id).lean()).readAt instanceof Date);

    // Someone else's alert reads as missing, and is left alone.
    const stranger = await request(`/notifications/${read._id}/unread`, { method: "PATCH", headers: headersFor(other) });
    assert.equal(stranger.status, 404);
    assert.equal((await Notification.findById(read._id).lean()).isRead, true);

    const noToken = await request(`/notifications/${read._id}/unread`, { method: "PATCH" });
    assert.equal(noToken.status, 401);

    console.log("PASS: mark read and unread, unread count, repeat presses, other users and no sign-in");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
