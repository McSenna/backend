"use strict";
const assert = require("node:assert/strict");
const h = require("./helpers/medicalRecordHarness");
const Baby = require("../../models/Baby");
const Dose = require("../../models/ImmunizationDose");
const MedicalRecord = require("../../models/MedicalRecord");
const {
  INITIAL_SCHEDULE,
} = require("../../services/immunization/scheduleDefinition");
const {
  initializeImmunization,
} = require("../../services/immunization/initialize");
(async () => {
  let failed = false;
  try {
    await h.setupWithFixtures();
    await initializeImmunization();
    const midwife = await h.createStaff("midwife");
    const baby = await Baby.create({
      motherMasterResidentId: "TEST-F",
      name: "Fictional legacy newborn",
      dateOfBirth: "2026-08-13",
      scheduleVersion: INITIAL_SCHEDULE.version,
      createdBy: midwife._id,
      requestKey: "startup-missing-summary",
    });
    // Pre-feature ledgers existed without the derived MedicalRecord summary.
    await Dose.create(
      ["bcg-1", "hepb-1"].map((doseKey) => ({
        babyId: baby._id,
        doseKey,
        scheduleVersion: INITIAL_SCHEDULE.version,
        state: "administered",
        administeredOn: "2026-09-13",
        administeredBy: "Fictional midwife",
        recordedBy: midwife._id,
        history: [
          {
            action: "administered",
            reason: "Initial administration record",
            actor: midwife._id,
            at: new Date("2026-10-24T05:29:00Z"),
            previous: null,
          },
        ],
      })),
    );
    const before = JSON.stringify(
      await Dose.find({ babyId: baby._id }).sort({ doseKey: 1 }).lean(),
    );
    const unrelated = (
      await MedicalRecord.collection.insertOne({
        serviceType: "prenatal",
        source: "walk_in",
        masterResidentId: "TEST-F",
        completedAt: new Date("2026-01-01"),
        assessment: "Fictional unrelated record",
      })
    ).insertedId;
    const unrelatedBefore = JSON.stringify(
      await MedicalRecord.findById(unrelated).lean(),
    );
    assert.equal(
      (await h.search(midwife, { serviceType: "immunization" })).body.records
        .length,
      0,
      "reproduce: clinical history exists but medical-record list is empty",
    );
    await initializeImmunization();
    let rows = (await h.search(midwife, { serviceType: "immunization" })).body
      .records;
    assert.equal(
      rows.length,
      1,
      "startup must restore the missing medical-record list entry for an identified baby ledger",
    );
    assert.equal(rows[0].recordStatus, "in_progress");
    assert.deepEqual(rows[0].immunizationProgress, {
      administered: 2,
      total: 15,
    });
    assert.equal(rows[0].baby._id, String(baby._id));
    const summary = await MedicalRecord.findOne({
      immunizationBabyId: baby._id,
    }).lean();
    await initializeImmunization();
    rows = (await h.search(midwife, { serviceType: "immunization" })).body
      .records;
    assert.equal(rows.length, 1, "restarts never duplicate existing summaries");
    assert.equal(
      JSON.stringify(await MedicalRecord.findById(summary._id).lean()),
      JSON.stringify(summary),
      "a restart does not rewrite an existing summary",
    );
    assert.equal(
      JSON.stringify(
        await Dose.find({ babyId: baby._id }).sort({ doseKey: 1 }).lean(),
      ),
      before,
      "original clinical history is preserved exactly",
    );
    assert.equal(
      JSON.stringify(await MedicalRecord.findById(unrelated).lean()),
      unrelatedBefore,
      "unrelated medical records remain unchanged",
    );
    console.log(
      "Startup restores missing immunization list entries idempotently and preserves clinical and unrelated records",
    );
  } catch (error) {
    failed = true;
    console.error(error);
  }
  await h.finish(failed);
})();
