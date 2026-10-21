"use strict";

// Invented fixtures. The two single sub-statuses must save, reopen, edit and
// filter as exact values, never as partial matches of "single".
const assert = require("node:assert/strict");
const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const { residentIdentityKey } = require("../../services/masterList/residentIdentity");
const harness = require("./helpers/masterListHarness");
const { request, asAdmin } = harness;
const BASE = "/admin/master-residents";
const row = (firstName, civilStatus, address = "Purok 1, Centro") => ({
  firstName, lastName: "Fixture", middleName: "", suffix: "",
  dateOfBirth: "1990-01-01", sex: "female", civilStatus,
  barangay: "Testville", address, role: "resident",
});

(async () => {
  try {
    await harness.setup();
    const admin = await User.create({
      fullname: "Civil Test Admin", email: "civil@maslogcare.test", password: "TestPass123!",
      role: "admin", status: "active", verified: true, gender: "female",
      dateOfBirth: new Date("1980-01-01"), address: "Test Hall",
    });
    const headers = asAdmin(admin);
    const create = async (payload) => {
      const response = await request(BASE, { method: "POST", headers, body: payload });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.body.record;
    };
    const reopened = async (id) => (await request(`${BASE}/${id}`, { headers })).body.record.civilStatus;

    const liveIn = await create(row("Livein", "single_live_in"));
    const solo = await create(row("Solo", "single_solo_parent"));
    assert.equal(liveIn.civilStatus, "single_live_in");
    assert.equal(solo.civilStatus, "single_solo_parent");
    assert.equal(await reopened(liveIn._id), "single_live_in");
    assert.equal((await MasterResident.findById(solo._id).lean()).civilStatus, "single_solo_parent");

    const edited = await request(`${BASE}/${liveIn._id}`, { method: "PATCH", headers, body: { address: "Purok 2, Pangulo" } });
    assert.equal(edited.body.record.civilStatus, "single_live_in", "unrelated edits keep the status");
    for (const next of ["single_solo_parent", "single", "single_live_in"]) {
      const response = await request(`${BASE}/${liveIn._id}`, { method: "PATCH", headers, body: { civilStatus: next } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(await reopened(liveIn._id), next);
    }
    for (const bad of ["Single - Live In", "single live in", "live_in", "single_"]) {
      const response = await request(BASE, { method: "POST", headers, body: row("Rejected", bad) });
      assert.equal(response.status, 422, `${bad}: ${JSON.stringify(response.body)}`);
      assert.ok(response.body.fieldErrors?.civilStatus);
    }

    for (const [name, status, address] of [
      ["Plain", "single", "Purok 1, Centro"], ["Plainer", "single", "Purok 2, Pangulo"],
      ["Married", "married", "Purok 1, Centro"], ["Solotwo", "single_solo_parent", "Purok 2, Pangulo"],
      ["Widowed", "widowed", "Purok 1, Centro"], ["Separated", "separated", "Purok 1, Centro"],
    ]) await create(row(name, status, address));
    const legacy = { ...row("Legacy", undefined), dateOfBirth: new Date("1990-01-01"), masterResidentId: "CIVIL-LEGACY", isActive: true };
    delete legacy.civilStatus;
    await MasterResident.collection.insertOne({ ...legacy, identityKey: residentIdentityKey(legacy) });

    const names = async (query) => {
      const response = await request(`${BASE}?status=all&${query}`, { headers });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.records.map((record) => record.firstName).sort();
    };
    assert.deepEqual(await names("civilStatus=single"), ["Plain", "Plainer"]);
    assert.deepEqual(await names("civilStatus=single_live_in"), ["Livein"]);
    assert.deepEqual(await names("civilStatus=single_solo_parent"), ["Solo", "Solotwo"]);
    assert.deepEqual(await names("civilStatus=married"), ["Married"]);
    assert.deepEqual(await names("civilStatus=widowed"), ["Widowed"]);
    assert.deepEqual(await names("civilStatus=separated"), ["Separated"]);
    assert.equal((await names("civilStatus=all")).length, 9, "all includes the legacy record without a status");
    assert.equal((await names("")).length, 9);

    const purok = encodeURIComponent("Purok 2, Pangulo");
    assert.deepEqual(await names(`civilStatus=single_solo_parent&purok=${purok}`), ["Solotwo"]);
    assert.deepEqual(await names(`civilStatus=single_solo_parent&search=solo&role=resident`), ["Solo", "Solotwo"]);
    assert.deepEqual(await names(`civilStatus=single_live_in&purok=${purok}`), ["Livein"]);
    assert.deepEqual(await names(`civilStatus=single_live_in&search=solo`), []);
    const pages = [];
    for (const page of [1, 2]) {
      const response = await request(`${BASE}?status=all&civilStatus=single_solo_parent&sort=name_desc&limit=1&page=${page}`, { headers });
      assert.equal(response.body.pagination.total, 2);
      assert.equal(response.body.pagination.totalPages, 2);
      pages.push(...response.body.records.map((record) => record.firstName));
    }
    assert.deepEqual(pages, ["Solotwo", "Solo"]);

    const legacyRecord = (await request(`${BASE}?status=all&search=legacy`, { headers })).body.records[0];
    assert.equal(legacyRecord.civilStatus ?? "", "", "a record saved before civil status existed still lists");
    assert.equal((await request(`${BASE}/${legacyRecord._id}`, { headers })).status, 200);

    console.log("PASS: single sub-statuses save, reopen, edit and filter exactly with search, purok, role, sort and pagination");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await harness.teardown();
  }
})();
