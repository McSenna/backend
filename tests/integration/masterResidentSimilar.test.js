"use strict";
// The Add resident form's look-alike check: what counts as similar, what the
// warning returns, and the save guard that waits for the admin to confirm.
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const MasterResident = require("../../models/MasterResident");
const { createMasterResident } = require("../../services/masterList/masterResidentAdmin");
const { findSimilarResidents, purokOf } = require("../../services/masterList/similarResidents");

const row = (extra = {}) => ({
  firstName: "Testa", middleName: "Fix", lastName: "Fixture", suffix: "", dateOfBirth: "1990-04-12",
  sex: "female", civilStatus: "single", barangay: "Maslog", address: "Purok 2, Test Street", ...extra,
});
const count = async (query) => (await findSimilarResidents(query)).total;

(async () => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await MasterResident.init();
    await createMasterResident(row(), null);

    // Nothing to compare until a last name and either a first name or a birth date are given.
    assert.equal(await count({}), 0);
    assert.equal(await count({ lastName: "Fixture" }), 0);
    assert.equal(await count({ firstName: "Testa", dateOfBirth: "1990-04-12" }), 0);

    // Same last name, first names that start the same either way, without case or accents.
    assert.equal(await count({ lastName: "FIXTURE", firstName: "tes" }), 1);
    assert.equal(await count({ lastName: "Fíxture", firstName: "Téstarossa" }), 1);
    assert.equal(await count({ lastName: "Fixture", firstName: "Other" }), 0);
    // Or the same birth date with any first name.
    assert.equal(await count({ lastName: "Fixture", firstName: "Other", dateOfBirth: "1990-04-12" }), 1);
    assert.equal(await count({ lastName: "Fixture", firstName: "Other", dateOfBirth: "1990-04-13" }), 0);
    assert.equal(await count({ lastName: "Different", firstName: "Testa", dateOfBirth: "1990-04-12" }), 0);

    // The warning carries the name, birth date and purok only.
    const { matches } = await findSimilarResidents({ lastName: "Fixture", firstName: "Testa" });
    assert.deepEqual(Object.keys(matches[0]).sort(), ["dateOfBirth", "firstName", "lastName", "middleName", "purok", "suffix"]);
    assert.equal(matches[0].dateOfBirth, "1990-04-12");
    assert.equal(matches[0].purok, "Purok 2");
    assert.equal(purokOf("Test Street"), "");

    // At most three rows, with the full count beside them.
    for (const firstName of ["Testb", "Testc", "Testd"]) await createMasterResident(row({ firstName }), null);
    const many = await findSimilarResidents({ lastName: "Fixture", firstName: "Test" });
    assert.equal(many.total, 4);
    assert.equal(many.matches.length, 3);

    // The form's save waits for confirmation; a confirmed or unchecked save goes through.
    await assert.rejects(
      createMasterResident(row({ firstName: "Testa", middleName: "Second" }), null, { checkSimilar: true }),
      (error) => error.statusCode === 409 && error.code === "POSSIBLE_DUPLICATE" && error.details.similar === 1
    );
    assert.equal(await MasterResident.countDocuments({ middleName: "Second" }), 0);
    await createMasterResident(row({ firstName: "Testa", middleName: "Second" }), null);
    await createMasterResident(row({ firstName: "Unique", lastName: "Nobody" }), null, { checkSimilar: true });

    // Deleted records are never matched.
    await MasterResident.updateMany({ lastName: "Nobody" }, { $set: { deletedAt: new Date() } });
    assert.equal(await count({ lastName: "Nobody", firstName: "Unique" }), 0);

    console.log("PASS: similar-resident matching, warning rows and the confirm-before-save guard");
  } finally {
    await mongoose.disconnect();
    if (db) await db.stop();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
