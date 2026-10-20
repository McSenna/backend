"use strict";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { migrateResidentIdentities } = require("../../services/masterList/residentIdentityMigration");
const { translateDuplicateError, IDENTITY_INDEX } = require("../../services/masterList/residentIdentity");
const MasterResident = require("../../models/MasterResident");
const { createMasterResident, updateMasterResident, setMasterResidentActive } = require("../../services/masterList/masterResidentAdmin");
const { importMasterResidents } = require("../../services/masterList/masterResidentImport");
const row = (extra = {}) => ({ firstName: "Testa", middleName: "", lastName: "Fixture", suffix: "", dateOfBirth: "1990-04-12", sex: "female", civilStatus: "single", barangay: "Maslog", address: "001 Test Street", ...extra });
const duplicate = (error) => error.statusCode === 409 && error.code === "DUPLICATE_RESOURCE" && Boolean(error.details?.fieldErrors?.address);
(async () => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await MasterResident.init();
    const first = await createMasterResident(row(), null);
    await assert.rejects(createMasterResident(row({ firstName: " TESTA ", middleName: null, address: " 001 TEST STREET " }), null), duplicate);
    await setMasterResidentActive(first._id, false, null);
    await assert.rejects(createMasterResident(row({ isActive: true, status: "active" }), null), duplicate);
    for (const extra of [{ address: "01 Test Street" }, { lastName: "Fix-ture" }, { middleName: "Other" }, { suffix: "Jr." }, { sex: "male" }, { civilStatus: "married" }, { barangay: "Other" }, { dateOfBirth: "1990-04-13" }]) {
      await createMasterResident(row(extra), null);
    }
    const other = await createMasterResident(row({ firstName: "Other" }), null);
    await assert.rejects(updateMasterResident(other._id, { firstName: "Testa" }, null), duplicate);
    assert.equal((await MasterResident.findById(other._id)).firstName, "Other");
    const raced = await Promise.allSettled(Array.from({ length: 8 }, () => createMasterResident(row({ firstName: "Concurrent" }), null)));
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(raced.filter((r) => r.status === "rejected").every((r) => duplicate(r.reason)));
    await createMasterResident(row({ masterResidentId: "REG-001", firstName: "Registry" }), null);
    await assert.rejects(createMasterResident(row({ masterResidentId: "REG-001", firstName: "Different" }), null),
      (e) => e.statusCode === 409 && Boolean(e.details?.fieldErrors?.masterResidentId));
    const before = await MasterResident.countDocuments();
    await assert.rejects(importMasterResidents([row({ firstName: "Import" }), row({ firstName: " IMPORT " })], null));
    assert.equal(await MasterResident.countDocuments(), before);
    const imports = await Promise.allSettled([0, 1].map((n) => importMasterResidents([row({ firstName: `Batch${n}` }), row({ firstName: "Shared" })], null)));
    assert.equal(imports.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await MasterResident.countDocuments(), before + 2);
    await assert.rejects(createMasterResident(row({ firstName: "" }), null), (e) => e.statusCode === 422);
    const unrelated = Object.assign(new Error("other index"), { code: 11000, keyPattern: { other: 1 } });
    assert.equal(translateDuplicateError(unrelated), unrelated);
    const legacy = mongoose.connection.collection("legacy_identity_test");
    const old = { ...row(), dateOfBirth: new Date("1990-04-12") };
    await legacy.insertMany([{ ...old, masterResidentId: "OLD-1" }, { ...old, masterResidentId: "OLD-2" }]);
    assert.equal((await migrateResidentIdentities(legacy, { apply: true })).conflicts, 1);
    assert.equal(await legacy.countDocuments({ identityKey: { $exists: true } }), 0);
    await legacy.deleteOne({ masterResidentId: "OLD-2" });
    assert.equal((await migrateResidentIdentities(legacy)).needsBackfill, 1);
    assert.equal(await legacy.countDocuments({ identityKey: { $exists: true } }), 0);
    assert.equal((await migrateResidentIdentities(legacy, { apply: true })).applied, true);
    assert.equal((await migrateResidentIdentities(legacy, { apply: true })).needsBackfill, 0);
    await assert.rejects(legacy.insertOne({ ...old, identityKey: (await legacy.findOne({})).identityKey }), (e) => e.code === 11000);
    await legacy.insertOne({ ...old, firstName: "", identityKey: "invalid" });
    assert.equal((await migrateResidentIdentities(legacy, { apply: true })).invalid, 1);
    await MasterResident.collection.dropIndex(IDENTITY_INDEX);
    await assert.rejects(createMasterResident(row({ firstName: "Unprotected" }), null), (e) => e.statusCode === 503);
    assert.equal(await MasterResident.countDocuments({ firstName: "Unprotected" }), 0);
    const { initializeResidentIdentity } = require("../../services/masterList/residentIdentityStartup");
    await MasterResident.collection.insertMany([
      { ...old, masterResidentId: "LEG-1", firstName: "LegacyOne" },
      { ...old, masterResidentId: "LEG-2", firstName: "LegacyTwo" },
    ]);
    const ready = await initializeResidentIdentity();
    assert.equal(ready.applied, true);
    assert.equal(ready.needsBackfill, 2);
    assert.equal(await MasterResident.countDocuments({ identityKey: { $exists: false } }), 0);
    await createMasterResident(row({ firstName: "Recovered" }), null);
    await assert.rejects(createMasterResident(row({ firstName: " RECOVERED " }), null), duplicate);
    assert.equal((await initializeResidentIdentity()).needsBackfill, 0);
    await MasterResident.collection.dropIndex(IDENTITY_INDEX);
    await MasterResident.collection.insertOne({ ...old, masterResidentId: "LEG-3", firstName: "LegacyOne" });
    await assert.rejects(initializeResidentIdentity(), (e) => e.statusCode === 503);
    assert.equal(await MasterResident.countDocuments({ masterResidentId: "LEG-3", identityKey: { $exists: false } }), 1);
    console.log("PASS: personal-information duplicates, normalization, differences, inactive status, edits, concurrency and atomic imports");
  } finally {
    await mongoose.disconnect();
    if (db) await db.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
