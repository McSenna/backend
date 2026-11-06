"use strict";

// The Resident details view: fetched by id, never cached, admin-only to read
// and to edit. Efren Romero Abaleta is the sample resident from the design brief.

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const { residentIdentityKey } = require("../../services/masterList/residentIdentity");
const harness = require("./helpers/masterListHarness");
const { request, asAdmin } = harness;
const BASE = "/admin/master-residents";

const person = (fullname, email, role) =>
  User.create({
    fullname, email, password: "TestPass123!", role, status: "active", verified: true,
    gender: "female", dateOfBirth: new Date("1980-01-01"), address: "Test Hall",
  });

(async () => {
  try {
    await harness.setup();
    const admin = await person("Details Test Admin", "details-admin@maslogcare.test", "admin");
    const doctor = await person("Details Test Doctor", "details-doctor@maslogcare.test", "doctor");
    const efren = {
      masterResidentId: "MSL-1CE7B195", firstName: "Efren", middleName: "Romero", lastName: "Abaleta",
      suffix: "", dateOfBirth: new Date("1958-10-13"), sex: "male", civilStatus: "married",
      barangay: "Maslog", address: "Purok 2, Pangulo", role: "resident", isActive: true,
    };
    const { insertedId } = await MasterResident.collection.insertOne({ ...efren, identityKey: residentIdentityKey(efren) });
    const id = String(insertedId);

    const fetched = await request(`${BASE}/${id}`, { headers: asAdmin(admin) });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    assert.equal(fetched.headers["cache-control"], "no-store", "the record is never cached");
    assert.equal(fetched.body.record._id, id);
    assert.equal(fetched.body.record.masterResidentId, "MSL-1CE7B195");
    assert.equal(fetched.body.record.linkedAccount, false);
    assert.equal(fetched.body.record.isActive, true);

    const listed = await request(`${BASE}?status=all`, { headers: asAdmin(admin) });
    assert.equal(listed.headers["cache-control"], "no-store", "list rows hold dates of birth too");

    // Hiding "Edit record" in the app is not the control: the server refuses non-admins.
    assert.equal((await request(`${BASE}/${id}`, { headers: asAdmin(doctor) })).status, 403);
    const doctorEdit = await request(`${BASE}/${id}`, { method: "PATCH", headers: asAdmin(doctor), body: { firstName: "Changed" } });
    assert.equal(doctorEdit.status, 403);
    assert.equal((await MasterResident.findById(id).lean()).firstName, "Efren", "a refused edit changes nothing");
    assert.equal((await request(`${BASE}/${id}`)).status, 401);

    // The view's "record not found" state.
    assert.equal((await request(`${BASE}/${new mongoose.Types.ObjectId()}`, { headers: asAdmin(admin) })).status, 404);
    await MasterResident.updateOne({ _id: insertedId }, { $set: { deletedAt: new Date() } });
    assert.equal((await request(`${BASE}/${id}`, { headers: asAdmin(admin) })).status, 404);
    assert.equal((await request(`${BASE}/not-an-id`, { headers: asAdmin(admin) })).status, 400);

    console.log("PASS: fetch by id, no-store caching, admin-only read and edit, not found and invalid ids");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await harness.teardown();
  }
})();
