"use strict";

// Invented fixtures. Exercise the HTTP boundary and real collections together.
const assert = require("node:assert/strict");
const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const harness = require("./helpers/masterListHarness");
const { request, asAdmin, tokenFor, MOBILE } = harness;
const BASE = "/admin/master-residents";
const row = (role) => ({
  firstName: "Classified", lastName: "Fixture", middleName: "", suffix: "",
  dateOfBirth: "1990-01-01", sex: "female", civilStatus: "single",
  barangay: "Testville", address: "Purok Test", role,
});
const account = (role) => User.create({
  fullname: `Test ${role}`, email: `${role}@classification.test`, password: "TestPass123!",
  role, status: "active", verified: true, gender: "female",
  dateOfBirth: new Date("1980-01-01"), address: "Test Clinic",
});

(async () => {
  try {
    await harness.setup();
    const admin = await account("admin");
    const headers = asAdmin(admin);
    const usersBefore = JSON.stringify(await User.find().lean());
    const created = await request(BASE, { method: "POST", headers, body: row("bhw") });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.record.role, "bhw");
    const id = created.body.record._id;
    assert.equal((await MasterResident.findById(id).lean()).role, "bhw");
    const linked = await account("resident");
    linked.masterResidentId = created.body.record.masterResidentId;
    await linked.save();
    const linkedBefore = JSON.stringify(await User.findById(linked._id).lean());
    for (const role of ["resident", "midwife", "bhw"]) {
      const edited = await request(`${BASE}/${id}`, { method: "PATCH", headers, body: { role } });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      assert.equal(edited.body.record.role, role);
      assert.equal((await request(`${BASE}/${id}`, { headers })).body.record.role, role);
      assert.equal((await MasterResident.findById(id).lean()).role, role);
    }
    const omitted = await request(`${BASE}/${id}`, { method: "PATCH", headers, body: { address: "Changed test purok" } });
    assert.equal(omitted.body.record.role, "bhw", "unrelated edits preserve classification");
    for (const role of ["admin", "doctor", "BHW", "", null, [], { value: "bhw" }, 1]) {
      for (const [method, path] of [["POST", BASE], ["PATCH", `${BASE}/${id}`]]) {
        const response = await request(path, { method, headers, body: row(role) });
        assert.equal(response.status, 422, `${method} rejects ${JSON.stringify(role)}: ${JSON.stringify(response.body)}`);
        assert.ok(response.body.fieldErrors?.role);
      }
    }
    assert.equal((await MasterResident.findById(id).lean()).role, "bhw", "failed saves preserve role");
    assert.equal(JSON.stringify(await User.findById(linked._id).lean()), linkedBefore, "classifying a linked record never changes its account");
    assert.equal(JSON.stringify(await User.findById(admin._id).lean()), usersBefore.slice(1, -1));
    for (const role of ["resident", "bhw", "midwife"]) {
      const payload = { ...row(role), firstName: `Test${role}` };
      const added = await request(BASE, { method: "POST", headers, body: payload });
      assert.equal(added.status, 201);
      assert.equal(added.body.record.role, role);
    }
    const legacy = await request(BASE, { method: "POST", headers, body: { ...row(undefined), firstName: "Legacy" } });
    assert.equal(legacy.body.record.role, "resident");
    const legacyId = legacy.body.record._id;
    for (const unsetValue of [undefined, null, ""]) {
      await MasterResident.collection.updateOne({ masterResidentId: legacy.body.record.masterResidentId },
        unsetValue === undefined ? { $unset: { role: "" } } : { $set: { role: unsetValue } });
      assert.equal((await request(`${BASE}/${legacyId}`, { headers })).body.record.role, "resident");
      const listed = await request(`${BASE}?search=resident&limit=1&page=1`, { headers });
      assert.equal(listed.status, 200);
      assert.equal(listed.body.pagination.total, 2, "role search includes unclassified records");
      assert.equal(listed.body.records.length, 1, "role search remains paginated");
      const edited = await request(`${BASE}/${legacyId}`, { method: "PATCH", headers, body: { address: "Legacy test purok" } });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      assert.equal(edited.body.record.role, "resident");
    }
    for (const role of ["resident", "bhw", "midwife", "doctor"]) {
      const caller = role === "resident" ? linked : await account(role);
      const callerHeaders = role === "resident" ? { ...MOBILE } : { "X-Client-Platform": "web" };
      callerHeaders.Authorization = `Bearer ${tokenFor(caller, role === "resident" ? "mobile" : "web")}`;
      for (const [method, path] of [["POST", BASE], ["PATCH", `${BASE}/${id}`], ["POST", `${BASE}/import`]]) {
        const body = path.endsWith("import") ? { records: [row("midwife")] } : row("midwife");
        assert.equal((await request(path, { method, body })).status, 401);
        assert.equal((await request(path, { method, headers: callerHeaders, body })).status, 403);
      }
    }
    const imported = await request(`${BASE}/import`, { method: "POST", headers,
      body: { records: [{ ...row("midwife"), firstName: "Imported" }] } });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    assert.equal((await MasterResident.findOne({ firstName: "Imported" }).lean()).role, "midwife");
    const beforeImport = await MasterResident.countDocuments();
    const badImport = await request(`${BASE}/import`, { method: "POST", headers,
      body: { records: [{ ...row("bhw"), firstName: "Validimport" }, { ...row("admin"), firstName: "Invalidimport" }] } });
    assert.equal(badImport.status, 400);
    assert.ok(badImport.body.rowErrors[0].fieldErrors.role);
    assert.equal(await MasterResident.countDocuments(), beforeImport);

    const { migrateResidentRoles } = require("../../services/masterList/residentRoleMigration");
    // Backfill is safe to rerun, and cannot overwrite an assigned role or account.
    await MasterResident.collection.updateOne({ masterResidentId: legacy.body.record.masterResidentId }, { $unset: { role: "" } });
    const accountsBeforeMigration = JSON.stringify(await User.find().lean());
    assert.equal((await migrateResidentRoles(MasterResident.collection)).needsBackfill, 1);
    assert.equal((await MasterResident.collection.findOne({ masterResidentId: legacy.body.record.masterResidentId })).role, undefined);
    assert.equal((await migrateResidentRoles(MasterResident.collection, { apply: true })).modified, 1);
    assert.equal((await migrateResidentRoles(MasterResident.collection, { apply: true })).modified, 0);
    assert.equal((await MasterResident.findById(id).lean()).role, "bhw");
    assert.equal(JSON.stringify(await User.find().lean()), accountsBeforeMigration);
    console.log("PASS: role persistence, validation, legacy fallback, search/pagination, authorization, import, migration and account separation");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await harness.teardown();
  }
})();
