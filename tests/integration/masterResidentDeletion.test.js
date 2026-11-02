"use strict";

// Invented fixtures. The real HTTP API and an isolated MongoDB exercise retention and permissions.
const assert = require("node:assert/strict");
const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const SystemLog = require("../../models/SystemLog");
const { countMasterResidents } = require("../../services/masterList/masterResidentRows");
const { linkBlockerFor } = require("../../services/masterList/masterLink");
const harness = require("./helpers/masterListHarness");
const { request, asAdmin, tokenFor, MOBILE } = harness;
const BASE = "/admin/master-residents";
const account = (role) => User.create({
  fullname: `Test ${role}`, email: `${role}@deletion.test`, password: "TestPass123!",
  role, status: "active", verified: true, gender: "female",
  dateOfBirth: new Date("1980-01-01"), address: "Test Clinic",
});

(async () => {
  try {
    await harness.setup();
    const admin = await account("admin");
    const headers = asAdmin(admin);
    const create = async (firstName) => {
      const response = await request(BASE, { method: "POST", headers, body: {
        firstName, lastName: "Fixture", dateOfBirth: "1990-01-01", sex: "female",
        civilStatus: "single", barangay: "Testville", address: "Purok Test", role: "resident",
      } });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.record;
    };
    const target = await create("Deleted");
    const kept = await create("Kept");
    const linked = await account("resident");
    linked.masterResidentId = target.masterResidentId;
    await linked.save();

    assert.equal((await request(`${BASE}/${target._id}`, { method: "DELETE" })).status, 401);
    for (const role of ["resident", "bhw", "midwife", "doctor"]) {
      const caller = role === "resident" ? linked : await account(role);
      const platform = role === "resident" ? "mobile" : "web";
      const response = await request(`${BASE}/${target._id}`, { method: "DELETE", headers: {
        ...(platform === "mobile" ? MOBILE : { "X-Client-Platform": "web" }),
        Authorization: `Bearer ${tokenFor(caller, platform)}`,
      } });
      assert.equal(response.status, 403, `${role}: ${JSON.stringify(response.body)}`);
    }
    assert.equal((await MasterResident.findById(target._id)).isActive, true, "denied requests keep the record");
    const usersBeforeDelete = JSON.stringify(await User.find().sort({ _id: 1 }).lean());
    const responses = await Promise.all([1, 2].map(() => request(`${BASE}/${target._id}`, { method: "DELETE", headers })));
    responses.forEach((response) => assert.equal(response.status, 200, JSON.stringify(response.body)));
    const retained = await MasterResident.findById(target._id).lean();
    assert.ok(retained, "soft deletion retains official identity and historical references");
    assert.equal(retained.isActive, false);
    assert.ok(retained.deletedAt instanceof Date);
    assert.equal(String(retained.deletedBy), String(admin._id));
    assert.equal(JSON.stringify(await User.find().sort({ _id: 1 }).lean()), usersBeforeDelete, "delete never mutates accounts");
    assert.equal(await SystemLog.countDocuments({ action: "MASTER_RESIDENT_DELETED" }), 1, "concurrent retries audit once");
    assert.equal(await countMasterResidents(), 1);
    for (const status of ["active", "inactive", "all"]) {
      const listed = await request(`${BASE}?status=${status}&limit=1&page=1`, { headers });
      assert.equal(listed.status, 200);
      assert.ok(listed.body.records.every((record) => record._id !== target._id));
      assert.equal(listed.body.counts.total, 1);
    }
    const lastPage = await request(`${BASE}?status=all&limit=1&page=2`, { headers });
    assert.equal(lastPage.body.pagination.total, 1);
    assert.equal(lastPage.body.pagination.totalPages, 1);
    assert.equal((await request(`${BASE}/${target._id}`, { headers })).status, 404);
    assert.equal((await request(`${BASE}/${target._id}`, { method: "PATCH", headers, body: { firstName: "Resurrected" } })).status, 404);
    assert.equal((await request(`${BASE}/${target._id}/status`, { method: "PATCH", headers, body: { active: true } })).status, 404);
    assert.equal(await linkBlockerFor({ masterResidentId: target.masterResidentId, userId: linked._id }), "inactive_or_missing");
    assert.equal((await request(`${BASE}/invalid`, { method: "DELETE", headers })).status, 400);
    assert.equal((await request(`${BASE}/000000000000000000000000`, { method: "DELETE", headers })).status, 404);
    assert.equal((await request(`${BASE}/${kept._id}`, { headers })).body.record.firstName, "Kept");
    console.log("PASS: soft deletion, authorization, duplicate protection, audit, counts, paging, references and resurrection guards");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally { await harness.teardown(); }
})();
