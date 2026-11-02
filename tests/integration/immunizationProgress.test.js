"use strict";
const assert = require("node:assert/strict");
const h = require("./helpers/medicalRecordHarness");
const MedicalRecord = require("../../models/MedicalRecord");
const Dose = require("../../models/ImmunizationDose");
const User = require("../../models/User");
const call = (path, user, body) =>
  h.request(`/immunization${path}`, {
    method: "POST",
    headers: user.role === "resident" ? h.asResident(user) : h.as(user),
    body,
  });
(async () => {
  let failed = false;
  try {
    await h.setupWithFixtures();
    await require("../../services/immunization/initialize").initializeImmunization();
    const midwife = await h.createStaff("midwife");
    const mother = await h.createStaff("resident");
    const stranger = await h.createStaff("resident");
    const makeBaby = async (key) =>
      (
        await call("/babies", midwife, {
          motherMasterResidentId: "TEST-F",
          dateOfBirth: "2026-01-01",
          requestKey: key,
        })
      ).body.baby;
    const baby = await makeBaby("progress-first");
    const twin = await makeBaby("progress-twin");
    const context = { motherMasterResidentId: "TEST-F", babyId: baby._id };
    const administration = (doseKey) => ({
      ...context,
      doseKey,
      administeredOn: "2026-01-01",
      historical: true,
      administeredBy: "Fictional historical clinician",
    });
    assert.equal(
      await MedicalRecord.countDocuments({ immunizationBabyId: baby._id }),
      0,
      "opening a checklist does not save a draft",
    );
    assert.equal(
      (
        await call("/administrations", midwife, {
          ...administration("bcg-1"),
          administeredOn: "2999-01-01",
        })
      ).status,
      400,
    );
    assert.equal(
      await MedicalRecord.countDocuments({ immunizationBabyId: baby._id }),
      0,
      "failed saves create no medical summary",
    );
    const saves = await Promise.all(
      ["bcg-1", "hepb-1"].map((key) =>
        call("/administrations", midwife, administration(key)),
      ),
    );
    assert.deepEqual(
      saves.map((result) => result.status),
      [201, 201],
    );
    let summary = await MedicalRecord.findOne({
      immunizationBabyId: baby._id,
    }).lean();
    assert.ok(
      summary,
      "partial administered doses automatically create a medical record",
    );
    assert.equal(
      await MedicalRecord.countDocuments({ immunizationBabyId: baby._id }),
      1,
      "concurrent dose saves update one summary",
    );
    assert.equal(summary.recordStatus, "in_progress");
    assert.deepEqual(summary.immunizationProgress, {
      administered: 2,
      total: 15,
    });
    assert.equal(summary.masterResidentId, "TEST-F");
    assert.ok(!summary.resident, "record exists independently of an account");
    const id = String(summary._id);
    let checklist = (await call("/checklist", midwife, context)).body;
    assert.equal(checklist.medicalRecord._id, id);
    assert.equal(checklist.medicalRecord.recordStatus, "in_progress");
    assert.equal(
      checklist.legacyReviewRequired,
      false,
      "the generated summary is not ambiguous legacy data",
    );
    const rows = (await h.search(midwife)).body.records;
    const row = rows.find((item) => item._id === id);
    assert.equal(row.recordStatus, "in_progress");
    assert.equal(row.baby._id, baby._id);
    const detail = await h.request(`/medical-record-masterlist/${id}`, {
      headers: h.as(midwife),
    });
    assert.equal(
      detail.body.detail.editable,
      false,
      "derived summaries cannot bypass clinical corrections",
    );
    const edit = await h.request(`/medical-record-masterlist/${id}`, {
      method: "PATCH",
      headers: h.as(midwife),
      body: {
        reason: "Attempt to change derived record",
        record: { assessment: "Changed" },
      },
    });
    assert.equal(edit.status, 403);
    assert.equal(
      (await call("/administrations", midwife, administration("bcg-1"))).status,
      409,
    );
    assert.equal(
      await MedicalRecord.countDocuments({ immunizationBabyId: baby._id }),
      1,
    );
    assert.equal(
      (
        await call("/administrations", midwife, {
          ...administration("bcg-1"),
          babyId: twin._id,
        })
      ).status,
      201,
    );
    assert.equal(
      (await MedicalRecord.findOne({ immunizationBabyId: twin._id }).lean())
        .immunizationProgress.administered,
      1,
    );
    await User.updateOne(
      { _id: mother._id },
      {
        $set: {
          masterResidentId: "TEST-F",
          verificationMethod: "admin_review",
          status: "active",
          verified: true,
        },
      },
    );
    await User.updateOne(
      { _id: stranger._id },
      {
        $set: {
          masterResidentId: "TEST-A",
          verificationMethod: "admin_review",
          status: "active",
          verified: true,
        },
      },
    );
    assert.ok(
      (await h.myRecords(mother)).body.medicalRecords.some(
        (item) => item._id === id,
      ),
      "verified mother sees ongoing records",
    );
    assert.ok(
      (await h.myRecordPage(mother)).body.medicalRecords.some(
        (item) => item._id === id,
      ),
      "paged history includes the ongoing program",
    );
    const parentDetail = await h.request(`/medical-records/${id}`, {
      headers: h.asResident(mother),
    });
    assert.equal(parentDetail.status, 200);
    assert.equal(
      parentDetail.body.medicalRecord.immunizationBabyId._id,
      baby._id,
    );
    assert.equal(
      (
        await h.request(`/medical-records/${id}`, {
          headers: h.asResident(stranger),
        })
      ).status,
      403,
    );
    await User.updateOne(
      { _id: mother._id },
      { $set: { verificationMethod: "email" } },
    );
    assert.ok(
      !(await h.myRecords(mother)).body.medicalRecords.some(
        (item) => item._id === id,
      ),
      "unverified identity linkage cannot expose baby summaries",
    );
    assert.equal(
      (
        await h.request(`/medical-records/${id}`, {
          headers: h.asResident(mother),
        })
      ).status,
      403,
    );
    await User.updateOne(
      { _id: mother._id },
      { $set: { verificationMethod: "admin_review" } },
    );
    for (const dose of checklist.doses.filter(
      (item) => !["bcg-1", "hepb-1"].includes(item.key),
    )) {
      assert.equal(
        (await call("/administrations", midwife, administration(dose.key)))
          .status,
        201,
      );
    }
    summary = await MedicalRecord.findById(id).lean();
    assert.equal(summary.recordStatus, "completed");
    assert.deepEqual(summary.immunizationProgress, {
      administered: 15,
      total: 15,
    });
    const recorded = await Dose.findOne({
      babyId: baby._id,
      doseKey: "bcg-1",
    }).lean();
    assert.equal(
      (
        await call("/corrections", midwife, {
          ...context,
          doseKey: "bcg-1",
          action: "void",
          reason: "Wrong source card entry",
          expectedRevision: recorded.revision,
        })
      ).status,
      200,
    );
    summary = await MedicalRecord.findById(id).lean();
    assert.equal(
      summary.recordStatus,
      "in_progress",
      "voiding an administration reopens the program",
    );
    assert.equal(summary.immunizationProgress.administered, 14);
    assert.equal(
      await MedicalRecord.countDocuments({ immunizationBabyId: baby._id }),
      1,
    );
    assert.equal(
      (await Dose.findById(recorded._id).lean()).history.length,
      2,
      "clinical correction audit is preserved",
    );
    await User.updateOne(
      { _id: mother._id },
      { $unset: { masterResidentId: 1 } },
    );
    assert.ok(
      !(await h.myRecords(mother)).body.medicalRecords.some(
        (item) => item._id === id,
      ),
      "unlink immediately hides ongoing records",
    );
    await MedicalRecord.deleteOne({ _id: id });
    const {
      backfillImmunizationMedicalRecords,
    } = require("../../services/immunization/medicalRecordSummary");
    await backfillImmunizationMedicalRecords();
    summary = await MedicalRecord.findOne({
      immunizationBabyId: baby._id,
    }).lean();
    assert.equal(summary.immunizationProgress.administered, 14);
    await backfillImmunizationMedicalRecords();
    assert.equal(
      await MedicalRecord.countDocuments({ immunizationBabyId: baby._id }),
      1,
      "migration backfill is idempotent",
    );
    const deferredBaby = await makeBaby("progress-deferred");
    assert.equal(
      (
        await call("/follow-up", midwife, {
          motherMasterResidentId: "TEST-F",
          babyId: deferredBaby._id,
          doseKey: "bcg-1",
          deferred: true,
          reason: "Clinical review needed",
          followUpOn: "2999-01-01",
        })
      ).status,
      200,
    );
    const deferredSummary = await MedicalRecord.findOne({
      immunizationBabyId: deferredBaby._id,
    }).lean();
    assert.equal(deferredSummary.recordStatus, "in_progress");
    assert.deepEqual(deferredSummary.immunizationProgress, {
      administered: 0,
      total: 15,
    });
    await User.updateOne({ _id: midwife._id }, { $set: { role: "resident" } });
    assert.equal(
      (
        await h.request(`/medical-records/${summary._id}`, {
          headers: h.asResident({ ...midwife.toObject(), role: "resident" }),
        })
      ).status,
      403,
      "a former recorder in a resident session cannot bypass verified parent ownership",
    );
    console.log(
      "Partial immunization medical records, completion/reopening, concurrent saves, twins and verified read access passed",
    );
  } catch (error) {
    failed = true;
    console.error(error);
  }
  await h.finish(failed);
})();
