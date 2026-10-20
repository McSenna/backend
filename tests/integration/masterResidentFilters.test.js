"use strict";

const assert = require("node:assert/strict");
const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const { residentIdentityKey } = require("../../services/masterList/residentIdentity");
const harness = require("./helpers/masterListHarness");
const { request, asAdmin } = harness;
const BASE = "/admin/master-residents";

(async () => {
  try {
    await harness.setup();
    const admin = await User.create({
      fullname: "Filter Test Admin", email: "filters@maslogcare.test", password: "TestPass123!",
      role: "admin", status: "active", verified: true, gender: "female",
      dateOfBirth: new Date("1980-01-01"), address: "Test Hall",
    });
    const fixtures = [
      ["FILTER-A", "Alpha", "resident", true],
      ["FILTER-B", "Beta", "bhw", true],
      ["FILTER-C", "Gamma", "bhw", false],
      ["FILTER-D", "Delta", "midwife", true],
      ["FILTER-E", "Legacy", undefined, true],
      ["FILTER-F", "Blank", "", false],
      ["FILTER-G", "Null", null, true],
    ].map(([masterResidentId, firstName, role, isActive], index) => ({
      masterResidentId, firstName, role, isActive, lastName: "Fixture",
      createdAt: new Date(Date.UTC(2020, 0, index + 1)),
      dateOfBirth: new Date("1990-01-01"), sex: "female", civilStatus: "single",
      barangay: "Testville", address: "Purok Test",
    }));
    const details = [
      ["single", "Purok 1, Centro"],
      ["married", "Purok 2, Pangulo"],
      ["widowed", "Purok 2, Pangulo 2"],
      ["separated", "Purok 10, Macaradat"],
      ["married", "Purok 1, Narra Street"],
      ["single", "Purok 2"],
      ["single", "Purok 3, Polique, Sample Street"],
    ];
    fixtures.forEach((record, index) => {
      [record.civilStatus, record.address] = details[index];
    });
    // Raw inserts represent legacy data from before role assignment existed.
    await MasterResident.collection.insertMany(fixtures.map((record) => ({ ...record, identityKey: residentIdentityKey(record) })));
    const headers = asAdmin(admin);
    const listed = async (query) => {
      const response = await request(`${BASE}?${query}`, { headers });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body;
    };
    const ids = (body) => body.records.map((record) => record.masterResidentId).sort();
    assert.deepEqual(ids(await listed("status=all&role=bhw")), ["FILTER-B", "FILTER-C"]);
    assert.deepEqual(ids(await listed("status=active&role=bhw")), ["FILTER-B"]);
    assert.deepEqual(ids(await listed("status=inactive&role=bhw")), ["FILTER-C"]);
    assert.deepEqual(ids(await listed("status=all&role=midwife")), ["FILTER-D"]);
    const residents = await listed("status=all&role=resident");
    assert.deepEqual(ids(residents), ["FILTER-A", "FILTER-E", "FILTER-F", "FILTER-G"]);
    assert.ok(residents.records.every((record) => record.role === "resident"));
    assert.deepEqual(ids(await listed("status=inactive&role=resident")), ["FILTER-F"]);
    assert.deepEqual(ids(await listed("status=all&role=bhw&search=gamma")), ["FILTER-C"]);
    assert.equal((await listed("status=active&role=bhw&search=gamma")).pagination.total, 0);
    assert.equal((await listed("status=all&role=all")).pagination.total, 7);
    const first = await listed("status=all&role=bhw&limit=1&page=1");
    const second = await listed("status=all&role=bhw&limit=1&page=2");
    assert.equal(first.pagination.total, 2);
    assert.equal(first.pagination.totalPages, 2);
    assert.equal(first.records.length, 1);
    assert.equal(second.records.length, 1);
    assert.notEqual(first.records[0]._id, second.records[0]._id);
    assert.deepEqual(first.counts, { active: 5, inactive: 2, total: 7 });
    assert.equal((await listed("role=all")).pagination.total, 5, "omitting status retains the API's active default");
    for (const query of ["role=admin", "role=bhw&role=resident", "status=unknown", "status=active&status=inactive"]) {
      const invalid = await request(`${BASE}?${query}`, { headers });
      assert.equal(invalid.status, 400, `${query}: ${JSON.stringify(invalid.body)}`);
      assert.equal(invalid.body.code, "VALIDATION_ERROR");
    }
    const withPurok = (purok, extra = {}) => new URLSearchParams({ status: "all", purok, ...extra }).toString();
    assert.deepEqual(ids(await listed("status=all&civilStatus=married")), ["FILTER-B", "FILTER-E"]);
    assert.deepEqual(ids(await listed("status=all&civilStatus=single")), ["FILTER-A", "FILTER-F", "FILTER-G"]);
    assert.deepEqual(ids(await listed("status=all&civilStatus=widowed")), ["FILTER-C"]);
    assert.deepEqual(ids(await listed("status=all&civilStatus=separated")), ["FILTER-D"]);
    assert.deepEqual(ids(await listed(withPurok("Purok 1, Centro"))), ["FILTER-A", "FILTER-E"]);
    assert.deepEqual(ids(await listed(withPurok("Purok 10, Macaradat"))), ["FILTER-D"]);
    assert.deepEqual(ids(await listed(withPurok("Purok 2, Pangulo"))), ["FILTER-B"]);
    assert.deepEqual(ids(await listed(withPurok("Purok 2, Pangulo 2"))), ["FILTER-C"]);
    assert.deepEqual(ids(await listed(withPurok("Purok 3, Polique"))), ["FILTER-G"]);
    assert.deepEqual(ids(await listed(withPurok("Purok 1, Centro", { civilStatus: "married", role: "resident", search: "legacy" }))), ["FILTER-E"]);
    assert.equal((await listed(withPurok("Purok 1, Centro", { civilStatus: "widowed" }))).pagination.total, 0);
    const filteredPage = await listed(withPurok("Purok 1, Centro", { limit: "1", page: "2" }));
    assert.equal(filteredPage.pagination.total, 2);
    assert.equal(filteredPage.records.length, 1);
    assert.deepEqual(ids(filteredPage), ["FILTER-E"]);
    for (const query of ["civilStatus=unknown", "civilStatus=single&civilStatus=married", "purok=unknown", "purok=all&purok=all"]) {
      assert.equal((await request(`${BASE}?${query}`, { headers })).status, 400, query);
    }
    const orderedIds = (body) => body.records.map((record) => record.masterResidentId);
    assert.deepEqual(orderedIds(await listed("status=all&sort=name_asc&limit=3")), ["FILTER-A", "FILTER-B", "FILTER-F"]);
    assert.deepEqual(orderedIds(await listed("status=all&sort=name_desc&limit=3")), ["FILTER-G", "FILTER-E", "FILTER-C"]);
    assert.deepEqual(orderedIds(await listed("status=all&sort=newest&limit=3")), ["FILTER-G", "FILTER-F", "FILTER-E"]);
    assert.deepEqual(orderedIds(await listed("status=all&sort=oldest&limit=3")), ["FILTER-A", "FILTER-B", "FILTER-C"]);
    assert.deepEqual(orderedIds(await listed("status=all&role=bhw&sort=newest")), ["FILTER-C", "FILTER-B"]);
    assert.deepEqual(orderedIds(await listed("status=all&sort=newest&limit=1&page=2")), ["FILTER-F"]);
    for (const query of ["sort=last_login_desc", "sort=newest&sort=oldest", "sort=constructor"]) {
      assert.equal((await request(`${BASE}?${query}`, { headers })).status, 400);
    }
    assert.equal((await request(`${BASE}?status=all&role=bhw`)).status, 401);
    console.log("PASS: role, civil status and purok filters, legacy addresses, pagination, sorting and invalid queries");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await harness.teardown();
  }
})();
