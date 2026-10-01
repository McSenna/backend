"use strict";

// Boots the real Express app on an in-memory replica set (appointment
// completion needs transactions) and signs staff and resident test users in.
process.env.TZ = "Asia/Manila";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env"), quiet: true });
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../../../app");
const User = require("../../../models/User");

const DAY_MS = 24 * 60 * 60 * 1000;

const createChecker = () => {
  const tally = { passed: 0, failed: 0 };
  const check = (name, condition, detail = "") => {
    tally[condition ? "passed" : "failed"] += 1;
    console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` — ${detail}` : ""}`);
  };
  return { check, tally };
};

const startHarness = async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  // Plain http, not fetch: fetch adds Sec-Fetch-* headers, which the platform
  // guard rightly treats as a browser and refuses for mobile sessions.
  const request = (path, { method = "GET", token, body } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(new URL(`${baseUrl}${path}`), {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "mobile",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }, (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }));
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await replSet.stop();
  };

  return { request, stop };
};

let userCount = 0;

/** Test-only accounts; every name and address here is invented. */
const createUser = async (role, dateOfBirth = "1990-01-15") => {
  userCount += 1;
  const user = await User.create({
    fullname: `Test ${role} ${userCount}`,
    email: `${role}.${userCount}@maslogcare.test`,
    password: "TestPassword123!",
    role,
    verified: true,
    status: "approved",
    phone: "09170000000",
    gender: "female",
    dateOfBirth: new Date(dateOfBirth),
    address: "Test address",
    approved_at: new Date(),
  });
  const token = jwt.sign({ userId: String(user._id), role, platform: "mobile" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  return { user, token };
};

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/** "YYYY-MM-DD" of the given weekday, `weeksAhead` weeks after its next occurrence (never today). */
const upcomingDateKey = (weekday, weeksAhead = 0) => {
  const today = startOfToday();
  const offset = ((weekday - today.getDay() + 7) % 7 || 7) + weeksAhead * 7;
  const date = new Date(today.getTime() + offset * DAY_MS + 12 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const localAt = (dateKey, time) => new Date(`${dateKey}T${time}:00+08:00`);

const finish = async (harness, tally) => {
  await harness.stop();
  console.log(`\nResults: ${tally.passed} passed, ${tally.failed} failed.`);
  process.exit(tally.failed > 0 ? 1 : 0);
};

module.exports = { createChecker, startHarness, createUser, upcomingDateKey, localAt, startOfToday, finish, DAY_MS };
