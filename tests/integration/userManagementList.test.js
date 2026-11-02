"use strict";
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const realtime = require("../../realtime/broadcast");

const ROW_KEYS = ["avatarUrl", "createdAt", "email", "fullname", "id", "lastLogin", "location", "portalAccess", "role", "status", "statusGroup", "updatedAt", "verificationId"];
let seq = 0;
const make = (role, status, extra = {}) => {
  seq += 1;
  return User.create({ fullname: `Synthetic ${role} ${seq}`, email: `${role}.${seq}@maslogcare.test`, password: "SyntheticPass123!", role, status, verified: ["approved", "active"].includes(status), phone: "09170000000", gender: "female", dateOfBirth: new Date("1990-01-01"), address: `Purok ${seq}`, ...extra });
};

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  const admin = await make("admin", "active");
  const headers = h.asAdmin(admin);
  const get = (path) => h.request(path, { headers });

  const pending = await make("resident", "pending");
  const rejected = await make("resident", "rejected");
  await make("resident", "approved");
  const active = await make("resident", "active", { fullname: "Paren (Synthetic) Name", lastLogin: new Date("2026-10-30T09:12:00Z") });
  await make("resident", "deactivated");
  await make("midwife", "inactive");
  await make("bhw", "suspended");
  const doctor = await make("doctor", "active");
  await User.collection.insertOne({ fullname: "Synthetic Legacy Staff", email: "legacy.staff@maslogcare.test", role: "bhw", verified: true, address: "Purok L", password: "x" });
  await User.collection.insertOne({ fullname: "Synthetic Legacy Pending", email: "legacy.pending@maslogcare.test", role: "resident", verified: false, address: "Purok P", password: "x" });
  const pendingVerification = await ResidentVerification.collection.insertOne({ user: pending._id, verificationStatus: "pending" });
  const rejectedVerification = await ResidentVerification.collection.insertOne({ user: rejected._id, verificationStatus: "rejected" });

  const page = await get("/users?segment=all&page=1&per_page=100");
  assert.equal(page.status, 200, JSON.stringify(page.body));
  for (const row of page.body.users) assert.deepEqual(Object.keys(row).sort(), ROW_KEYS, row.email);
  assert.equal(JSON.stringify(page.body).includes("dateOfBirth"), false);
  assert.equal(JSON.stringify(page.body).includes("password"), false);
  assert.equal(JSON.stringify(page.body).includes("09170000000"), false);
  assert.deepEqual(Object.keys(page.body.pagination).sort(), ["page", "perPage", "total", "totalPages"]);

  const { summary } = (await get("/users/summary")).body;
  assert.equal(summary.active + summary.requests + summary.rejected + summary.deactivated, summary.total);
  assert.equal(summary.staff + summary.residents, summary.total);
  assert.equal(summary.total, 11);
  assert.equal(summary.staff, 5);
  assert.equal(summary.approved, 1);
  assert.equal(summary.active, 5, "approved and active both count as active");
  assert.equal(summary.requests, 2);
  assert.equal(summary.rejected, 1);
  assert.equal(summary.deactivated, 3);
  assert.equal(summary.activePercent, 45);
  assert.equal(summary.masterlist, 0);

  for (const [segment, key] of [["active", "active"], ["requests", "requests"], ["rejected", "rejected"], ["deactivated", "deactivated"], ["all", "total"]]) {
    const list = await get(`/users?segment=${segment}&per_page=100`);
    assert.equal(list.body.pagination.total, summary[key], segment);
    assert.equal(list.body.users.length, summary[key], segment);
  }

  const emails = async (query) => (await get(`/users?${query}&per_page=100`)).body.users.map((row) => row.email);
  assert.ok((await emails("segment=active")).includes("legacy.staff@maslogcare.test"), "legacy verified staff is active");
  assert.ok((await emails("segment=requests")).includes("legacy.pending@maslogcare.test"), "legacy unverified is requested");
  const legacyRows = (await get("/users?segment=deactivated&per_page=100")).body.users;
  assert.ok(legacyRows.every((row) => row.statusGroup === "deactivated"), "older names read as deactivated");
  assert.equal((await emails("segment=active&status=approved")).length, 1);
  assert.equal((await emails("segment=active&status=rejected")).length, 0, "a status outside the segment matches nothing");
  assert.equal((await emails("segment=all&role=doctor"))[0], doctor.email);

  for (const text of ["(", ".*", "\\", "["]) {
    const literal = await get(`/users?search=${encodeURIComponent(text)}`);
    assert.equal(literal.status, 200, text);
    assert.equal(literal.body.pagination.total, text === "(" ? 1 : 0, `search ${text} is literal`);
  }
  assert.equal((await emails("search=purok%203")).length, 1, "search covers location");
  assert.equal((await get("/users?per_page=500")).body.pagination.perPage, 100);
  assert.equal((await get("/users")).body.pagination.perPage, 20, "no unpaged response");

  const row = (rows, user) => rows.find((entry) => entry.id === String(user._id));
  const requests = (await get("/users?segment=requests&per_page=100")).body.users;
  assert.equal(row(requests, pending).verificationId, String(pendingVerification.insertedId));
  const rejectedRows = (await get("/users?segment=rejected")).body.users;
  assert.equal(row(rejectedRows, rejected).verificationId, String(rejectedVerification.insertedId));
  assert.equal(row(page.body.users, active).verificationId, null);

  const staffAccess = row(page.body.users, doctor).portalAccess;
  assert.equal(staffAccess.state, "staff");
  assert.equal(staffAccess.web, true);
  assert.equal(staffAccess.mobile, true);
  const residentAccess = row(page.body.users, active).portalAccess;
  assert.deepEqual(Object.keys(residentAccess).sort(), ["eligible", "globalEnabled", "mobile", "override", "revision", "state", "web"]);
  assert.equal(residentAccess.state, "global_blocked");
  assert.equal(residentAccess.web, false);
  assert.equal(residentAccess.mobile, true);
  const deactivatedStaff = page.body.users.find((entry) => entry.role === "midwife");
  assert.equal(deactivatedStaff.portalAccess.state, "ineligible");
  assert.equal(deactivatedStaff.portalAccess.web, false);

  const detail = await get(`/users/${active._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.user.phone, "09170000000");
  assert.equal(detail.body.user.address, active.address);
  assert.ok(detail.body.user.dateOfBirth);
  assert.equal(detail.body.user._id, String(active._id));
  assert.equal(detail.body.user.id, String(active._id));
  assert.equal(JSON.stringify(detail.body).includes("password"), false);
  assert.equal((await get("/users/507f1f77bcf86cd799439011")).status, 404);
  assert.equal((await get("/users/not-an-id")).status, 400);

  for (const path of ["/users", "/users/summary", `/users/${active._id}`]) {
    assert.equal((await h.request(path)).status, 401, path);
    for (const role of ["doctor", "midwife", "bhw", "resident"]) {
      const asRole = await make(role, role === "resident" ? "approved" : "active");
      assert.equal((await h.request(path, { headers: h.asAdmin(asRole) })).status, 403, `${role} ${path}`);
    }
  }

  const sent = [];
  realtime.broadcast = (resource, action, payload) => sent.push({ resource, payload });
  delete require.cache[require.resolve("../../realtime/publishers/users")];
  const publisher = require("../../realtime/publishers/users");
  await publisher.publish([{ id: String(active._id), action: "updated", updatedKeys: ["fullname"] }]);
  const event = sent.find((entry) => entry.resource === "user");
  assert.deepEqual(Object.keys(event.payload).sort(), ROW_KEYS, "the realtime event cannot bypass the row allowlist");
  console.log("User management list assertions passed");
};
run().then(() => h.teardown()).catch(async (error) => { console.error(error); await h.teardown(); process.exitCode = 1; });
