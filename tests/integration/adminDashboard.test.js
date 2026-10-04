"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const SupportTicket = require("../../models/SupportTicket");
const InventoryItem = require("../../models/InventoryItem");

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
    password: "InitialPass123!",
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

const DAY_MS = 24 * 60 * 60 * 1000;

// Raw inserts: the dashboard only counts these documents, so the full validation payload isn't needed.
const insertRaw = (Model, docs) => Model.collection.insertMany(docs);

async function runTests() {
  const admin = await makeUser("admin", "active");
  const doctor = await makeUser("doctor", "active");
  const resident = await makeUser("resident", "approved");
  const applicant = await makeUser("resident", "pending");

  console.log("\nAuthorization");

  const anonymous = await request("/admin/dashboard");
  check("rejects unauthenticated requests with 401", anonymous.status === 401, `got ${anonymous.status}`);

  const asDoctor = await request("/admin/dashboard", { headers: headersFor(doctor) });
  check("rejects non-admin requests with 403", asDoctor.status === 403, `got ${asDoctor.status}`);

  console.log("\nAttention counts");

  const empty = await request("/admin/dashboard", { headers: headersFor(admin) });
  check("loads for an admin", empty.status === 200, `got ${empty.status}`);
  check(
    "reports zero attention items on a clean database",
    JSON.stringify(empty.body.attention) ===
      JSON.stringify({ pendingRegistrations: 0, openSupportTickets: 0, lowStockItems: 0, expiringItems: 0 }),
    JSON.stringify(empty.body.attention)
  );

  await insertRaw(ResidentVerification, [
    { user: applicant._id, verificationStatus: "pending" },
    { user: resident._id, verificationStatus: "approved" },
    { user: resident._id, verificationStatus: "rejected" },
  ]);
  await insertRaw(SupportTicket, [
    { ticketNumber: "SUP-1", status: "open" },
    { ticketNumber: "SUP-2", status: "in_review" },
    { ticketNumber: "SUP-3", status: "awaiting_user" },
    { ticketNumber: "SUP-4", status: "resolved" },
    { ticketNumber: "SUP-5", status: "closed" },
  ]);
  const soon = new Date(Date.now() + 10 * DAY_MS);
  const later = new Date(Date.now() + 90 * DAY_MS);
  await insertRaw(InventoryItem, [
    // Low stock and expiring: counts once in each list.
    { name: "Paracetamol", isActive: true, currentStock: 4, reorderLevel: 10, nearestExpiry: soon },
    // At the reorder level exactly: low.
    { name: "Amoxicillin", isActive: true, currentStock: 10, reorderLevel: 10, nearestExpiry: later },
    // Healthy stock, expiring soon.
    { name: "BCG vaccine", isActive: true, currentStock: 40, reorderLevel: 10, nearestExpiry: soon },
    // Out of stock with an old expiry date: low, but nothing left to expire.
    { name: "Syringes", isActive: true, currentStock: 0, reorderLevel: 5, nearestExpiry: soon },
    // Archived items never count.
    { name: "Old stock", isActive: false, currentStock: 0, reorderLevel: 10, nearestExpiry: soon },
    // Healthy and far from expiry.
    { name: "Cotton", isActive: true, currentStock: 80, reorderLevel: 10, nearestExpiry: null },
  ]);

  const loaded = await request("/admin/dashboard", { headers: headersFor(admin) });
  const attention = loaded.body.attention ?? {};
  check("counts only pending registrations", attention.pendingRegistrations === 1, `got ${attention.pendingRegistrations}`);
  check(
    "counts tickets that still need a staff reply",
    attention.openSupportTickets === 2,
    `got ${attention.openSupportTickets}`
  );
  check("counts active items at or below reorder level", attention.lowStockItems === 3, `got ${attention.lowStockItems}`);
  check(
    "counts in-stock active items expiring within 30 days",
    attention.expiringItems === 2,
    `got ${attention.expiringItems}`
  );
  check("still returns the existing metrics", typeof loaded.body.metrics?.totalUsers === "number");

  console.log("\nNewest accounts");

  // Seven residents joined after every staff account: the overall newest five are all residents.
  const base = Date.now() - 30 * DAY_MS;
  await insertRaw(User, [
    { fullname: "Staff Early", email: "staff.early@maslogcare.test", role: "bhw", verified: true, createdAt: new Date(base) },
    { fullname: "Staff Later", email: "staff.later@maslogcare.test", role: "midwife", verified: true, createdAt: new Date(base + DAY_MS) },
    ...Array.from({ length: 7 }, (_, index) => ({
      fullname: `Resident New ${index + 1}`,
      email: `resident.new.${index + 1}@maslogcare.test`,
      role: "resident",
      verified: true,
      // A few minutes from now, so they are newer than every account made above.
      createdAt: new Date(Date.now() + (index + 1) * 60 * 1000),
    })),
  ]);

  const newest = await request("/admin/dashboard?usersLimit=5", { headers: headersFor(admin) });
  const names = (list) => (list ?? []).map((user) => user.fullname);
  const isNewestFirst = (list) => (list ?? []).every((user, index, all) => index === 0 || new Date(all[index - 1].createdAt) >= new Date(user.createdAt));

  check("shows at most five accounts", newest.body.recentUsers?.length === 5, `got ${newest.body.recentUsers?.length}`);
  check(
    "lists the five most recently created accounts, newest first",
    JSON.stringify(names(newest.body.recentUsers)) ===
      JSON.stringify(["Resident New 7", "Resident New 6", "Resident New 5", "Resident New 4", "Resident New 3"]),
    JSON.stringify(names(newest.body.recentUsers))
  );
  check("lists only residents, newest first", (newest.body.recentResidents ?? []).every((user) => user.role === "resident") && newest.body.recentResidents?.length === 5 && isNewestFirst(newest.body.recentResidents));
  check(
    "lists staff even when residents fill the overall five",
    newest.body.recentStaff?.length > 0 &&
      (newest.body.recentStaff ?? []).every((user) => user.role !== "resident") &&
      isNewestFirst(newest.body.recentStaff) &&
      names(newest.body.recentStaff).indexOf("Staff Later") < names(newest.body.recentStaff).indexOf("Staff Early"),
    JSON.stringify(names(newest.body.recentStaff))
  );
  const staffTotal = await User.countDocuments({ role: { $ne: "resident" } });
  check("shows every staff account when there are fewer than five", newest.body.recentStaff?.length === Math.min(5, staffTotal), `got ${newest.body.recentStaff?.length} of ${staffTotal}`);
  const residentCount = (newest.body.roleDistribution ?? []).find((entry) => entry.role === "resident")?.count;
  check(
    "keeps the totals for the card's counts",
    newest.body.metrics.totalUsers === (await User.countDocuments({})) && residentCount === (await User.countDocuments({ role: "resident" })),
    JSON.stringify({ total: newest.body.metrics.totalUsers, residents: residentCount })
  );
}

(async () => {
  console.log("\n--- Testing Admin Dashboard API ---");
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
