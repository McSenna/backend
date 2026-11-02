"use strict";
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const SystemLog = require("../../models/SystemLog");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const { getClientIpAddress } = require("../../services/systemLog/requestContext");

const HEADER = '"Name","Email","Role","Account status","Portal access","Last login","Joined"';
let seq = 0;
const make = (role, status, extra = {}) => {
  seq += 1;
  return User.create({ fullname: `Synthetic ${role} ${seq}`, email: `${role}.export.${seq}@maslogcare.test`, password: "SyntheticPass123!", role, status, verified: ["approved", "active"].includes(status), phone: "09179998888", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Purok Secret, Test", ...extra });
};
const parseLines = (text) => text.replace(/^﻿/, "").trim().split("\r\n");

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  await make("admin", "active");
  // A fresh admin per call, so the per-admin export limit is only exercised where it is meant to be.
  const get = async (query) => h.request(`/users/export?${query}`, { headers: h.asAdmin(await make("admin", "active")) });

  await make("resident", "active", { fullname: 'Dela Cruz, "Ñino" Synthetic', email: "nino.export@maslogcare.test", lastLogin: new Date("2026-10-30T09:12:00Z") });
  await make("resident", "active", { fullname: "=HYPERLINK(1) Synthetic" });
  await make("resident", "deactivated");
  await make("doctor", "active");

  const all = await get("segment=all");
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const lines = parseLines(all.body);
  assert.equal(lines[0], HEADER);
  assert.equal(lines.length, 7, "admin, the export admin, and four accounts, plus the header");
  for (const secret of ["09179998888", "Purok Secret", "1990-01-01", "$2", "password"]) {
    assert.equal(all.body.includes(secret), false, `export must not contain ${secret}`);
  }
  assert.ok(lines.some((line) => line.startsWith('"Dela Cruz, ""Ñino"" Synthetic"')), "commas, quotes and ñ survive");
  assert.ok(lines.some((line) => line.startsWith(`"'=HYPERLINK(1) Synthetic"`)), "a leading = is defused");
  assert.ok(lines.some((line) => line.includes("Never")), "no sign-in reads Never");

  assert.equal(parseLines((await get("segment=deactivated")).body).length, 2, "honors the segment");
  assert.equal(parseLines((await get("segment=all&role=doctor")).body).length, 2, "honors the role");
  assert.equal(parseLines((await get("segment=active&search=nino.export")).body).length, 2, "honors search");
  const empty = await get("segment=rejected");
  assert.equal(empty.status, 200);
  assert.deepEqual(parseLines(empty.body), [HEADER], "zero rows returns only the header");
  assert.equal((await get("segment=all&search=%5B")).status, 200, "a regex character is literal");

  const log = await SystemLog.findOne({ action: "USERS_EXPORTED", "metadata.searched": true }).sort({ createdAt: -1 }).lean();
  assert.equal(log.metadata.segment, "all");
  assert.equal(log.metadata.searched, true);
  assert.equal(log.metadata.rows, 0);
  assert.ok(log.userId, "the log names who exported");
  assert.equal(log.role, "admin");
  const logs = JSON.stringify(await SystemLog.find({ action: "USERS_EXPORTED" }).lean());
  assert.equal(logs.includes("nino.export"), false, "the search text is never logged");

  assert.equal((await h.request("/users/export")).status, 401);
  for (const role of ["doctor", "midwife", "bhw", "resident"]) {
    assert.equal((await h.request("/users/export", { headers: h.asAdmin(await make(role, role === "resident" ? "approved" : "active")) })).status, 403, role);
  }

  const busy = h.asAdmin(await make("admin", "active"));
  for (let index = 0; index < 5; index += 1) assert.equal((await h.request("/users/export", { headers: busy })).status, 200);
  const limited = await h.request("/users/export", { headers: busy });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "RATE_LIMITED");

  const many = Array.from({ length: 10001 }, (_, index) => ({ fullname: `Synthetic Bulk ${index}`, email: `bulk.${index}@maslogcare.test`, role: "resident", status: "active", verified: true, address: "Test", password: "x" }));
  await User.collection.insertMany(many);
  const capped = await h.request("/users/export?segment=all", { headers: h.asAdmin(await make("admin", "active")) });
  assert.equal(capped.headers["x-export-truncated"], "true");
  assert.equal(parseLines(capped.body).length, 10001, "the header plus the row cap");
  const whole = await h.request("/users/export?segment=all&role=doctor", { headers: h.asAdmin(await make("admin", "active")) });
  assert.equal(whole.headers["x-export-truncated"], undefined);
  const crossOrigin = await h.request("/users/export?segment=all&role=doctor", { headers: { ...h.asAdmin(await make("admin", "active")), Origin: "http://localhost:8081" } });
  assert.match(String(crossOrigin.headers["access-control-expose-headers"]), /X-Export-Truncated/i, "the web client on another origin can read the flag");

  const forged = { headers: { "x-forwarded-for": "6.6.6.6" }, ip: "10.0.0.5", socket: { remoteAddress: "10.0.0.5" } };
  assert.equal(getClientIpAddress(forged), "10.0.0.5", "a forged header does not change the logged address");
  assert.equal(getClientIpAddress({ headers: {}, socket: { remoteAddress: "10.0.0.7" } }), "10.0.0.7");
  assert.equal(getClientIpAddress({ headers: {}, ip: "::1", socket: {} }), "unknown", "the local dev address reads as unknown, as before");
  console.log("User management export assertions passed");
};
run().then(() => h.teardown()).catch(async (error) => { console.error(error); await h.teardown(); process.exitCode = 1; });
