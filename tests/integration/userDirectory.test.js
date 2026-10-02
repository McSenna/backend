"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");

let mongod;
let server;
let baseUrl;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function request(path, options = {}) {
  const url = new URL(`${baseUrl}${path}`);
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const body = options.rawBody ?? (options.body ? JSON.stringify(options.body) : null);

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function setup() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

async function teardown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

let emailSeq = 0;
const makeUser = (role, status, extra = {}) =>
  User.create({
    fullname: `${role} ${status} ${++emailSeq}`,
    email: `${role}.${status}.${emailSeq}@maslogcare.test`,
    password: "InitialPassword123!",
    role,
    verified: status === "approved" || status === "active",
    status,
    phone: "09171234567",
    gender: "female",
    dateOfBirth: new Date("1990-01-01"),
    address: "Purok 1, Maslog",
    ...extra,
  });

const headersFor = (user, platform = "web") => ({
  Authorization: `Bearer ${jwt.sign(
    { userId: String(user._id), role: user.role, platform },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  )}`,
  "X-Client-Platform": platform,
});

const json = (response) => JSON.stringify(response.body);

async function runTests() {
  const admin = await makeUser("admin", "active");
  const doctor = await makeUser("doctor", "active", { lastLogin: new Date("2026-09-01T08:00:00Z") });
  const midwife = await makeUser("midwife", "inactive");
  const resident = await makeUser("resident", "approved", {
    fullname: "Zed Resident",
    address: "Purok 7, Sitio Test",
    lastLogin: new Date("2026-09-20T08:00:00Z"),
  });
  const parked = await makeUser("resident", "deactivated");
  const applicant = await makeUser("resident", "pending");
  // An older account with no stored status: verified staff resolve to active.
  await User.collection.insertOne({
    fullname: "Legacy Bhw",
    email: "legacy.bhw@maslogcare.test",
    role: "bhw",
    verified: true,
    address: "Purok 2",
    password: "not-a-real-hash",
    createdAt: new Date("2025-01-01T00:00:00Z"),
  });
  await ResidentVerification.collection.insertMany([
    { user: applicant._id, verificationStatus: "pending" },
    { user: parked._id, verificationStatus: "rejected" },
  ]);

  console.log("\nAuthorization");
  for (const path of ["/users?page=1", "/users/summary"]) {
    const anonymous = await request(path);
    check(`${path} rejects unauthenticated requests`, anonymous.status === 401, `got ${anonymous.status}`);
    const asDoctor = await request(path, { headers: headersFor(doctor) });
    check(`${path} rejects non-admins`, asDoctor.status === 403, `got ${asDoctor.status}`);
  }
  const bulkAsDoctor = await request("/users/status", {
    method: "PATCH",
    headers: headersFor(doctor),
    body: { ids: [String(resident._id)], action: "deactivate" },
  });
  check("bulk status rejects non-admins", bulkAsDoctor.status === 403, `got ${bulkAsDoctor.status}`);

  console.log("\nSummary");
  const summary = await request("/users/summary", { headers: headersFor(admin) });
  check("summary loads", summary.status === 200, `got ${summary.status}`);
  const expected = {
    total: 6,
    staff: 4,
    residents: 2,
    active: 3,
    approved: 1,
    deactivated: 2,
    addedThisMonth: 5,
    pendingRequests: 1,
    rejectedRequests: 1,
  };
  check("summary counts listed accounts only", JSON.stringify(summary.body.summary) === JSON.stringify(expected), json(summary));

  console.log("\nList");
  const page = await request("/users?page=1&pageSize=2&tab=masterlist", { headers: headersFor(admin) });
  check("pages the masterlist", page.body.users.length === 2 && page.body.pagination.total === 6, json(page));
  check("never returns password hashes", page.body.users.every((user) => !("password" in user)), json(page));
  check("sorts by last login, newest first", page.body.users[0].email === resident.email, page.body.users[0].email);

  const active = await request("/users?page=1&tab=active", { headers: headersFor(admin) });
  const activeEmails = active.body.users.map((user) => user.email);
  check("active tab holds active and approved accounts", active.body.pagination.total === 4, json(active));
  check("active tab includes legacy verified staff", activeEmails.includes("legacy.bhw@maslogcare.test"));
  check("active tab excludes pending applicants", !activeEmails.includes(applicant.email));

  const filtered = await request("/users?page=1&tab=active&status=approved&role=resident", { headers: headersFor(admin) });
  check("status and role filters combine", filtered.body.pagination.total === 1, json(filtered));

  const searched = await request("/users?page=1&tab=masterlist&query=sitio%20test", { headers: headersFor(admin) });
  check("search matches location", searched.body.pagination.total === 1, json(searched));
  const regexInput = await request("/users?page=1&query=.*", { headers: headersFor(admin) });
  check("search treats input as plain text", regexInput.body.pagination.total === 0, json(regexInput));

  const byName = await request("/users?page=1&sort=name_asc", { headers: headersFor(admin) });
  check("sorts by name", byName.body.users[byName.body.users.length - 1].email === resident.email);

  const legacy = await request("/users", { headers: headersFor(admin) });
  check("keeps the unpaged response without page", legacy.body.count === 7 && !legacy.body.pagination, json(legacy));

  console.log("\nBulk status");
  const bad = await request("/users/status", { method: "PATCH", headers: headersFor(admin), body: { ids: [], action: "deactivate" } });
  check("rejects an empty id list", bad.status === 400, `got ${bad.status}`);
  const badAction = await request("/users/status", { method: "PATCH", headers: headersFor(admin), body: { ids: [String(doctor._id)], action: "delete" } });
  check("rejects unknown actions", badAction.status === 400, `got ${badAction.status}`);

  const deactivated = await request("/users/status", {
    method: "PATCH",
    headers: headersFor(admin),
    body: { ids: [String(doctor._id), String(resident._id), String(admin._id), String(midwife._id)], action: "deactivate" },
  });
  check("deactivates eligible accounts", deactivated.status === 200 && deactivated.body.updatedIds.length === 2, json(deactivated));
  check("skips own account and already deactivated ones", deactivated.body.skippedIds.length === 2, json(deactivated));
  const [doctorAfter, residentAfter, adminAfter] = await Promise.all(
    [doctor, resident, admin].map((user) => User.findById(user._id).lean())
  );
  check("staff become inactive", doctorAfter.status === "inactive", doctorAfter.status);
  check("residents become deactivated", residentAfter.status === "deactivated", residentAfter.status);
  check("the admin stays active", adminAfter.status === "active", adminAfter.status);

  const reactivated = await request("/users/status", {
    method: "PATCH",
    headers: headersFor(admin),
    body: { ids: [String(doctor._id), String(resident._id), String(applicant._id)], action: "reactivate" },
  });
  check("reactivates deactivated accounts only", reactivated.body.updatedIds.length === 2, json(reactivated));
  const [doctorBack, residentBack, applicantAfter] = await Promise.all(
    [doctor, resident, applicant].map((user) => User.findById(user._id).lean())
  );
  check("staff return to active", doctorBack.status === "active", doctorBack.status);
  check("residents return to approved", residentBack.status === "approved", residentBack.status);
  check("pending applicants are untouched", applicantAfter.status === "pending", applicantAfter.status);
}

(async () => {
  console.log("\n--- Testing User Directory API ---");
  try {
    await setup();
    await runTests();
  } catch (error) {
    failed += 1;
    failures.push(`Unexpected error: ${error.stack || error.message}`);
    console.error(error);
  } finally {
    await teardown();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
})();
