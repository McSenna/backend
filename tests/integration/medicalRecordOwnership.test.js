"use strict";

// Who can read a resident's medical records, through every route that returns
// them. Ownership comes from the account's own link, never from anything the
// request sends. Every person and reading here is invented.

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const h = require("./helpers/medicalRecordHarness");
const User = require("../../models/User");
const MedicalRecord = require("../../models/MedicalRecord");
const Appointment = require("../../models/Appointment");

const VERIFIED = { verificationMethod: "admin_review", status: "active", verified: true };

const linkAccount = async (user, masterResidentId, extra = VERIFIED) => {
  await User.updateOne({ _id: user._id }, { $set: { masterResidentId, ...extra } });
  return User.findById(user._id).lean();
};
const immunization = (path, user, body) =>
  h.request(`/immunization${path}`, { method: "POST", headers: user.role === "resident" ? h.asResident(user) : h.as(user), body });
const open = (user, id) =>
  h.request(`/medical-records/${id}`, { headers: user.role === "resident" ? h.asResident(user) : h.as(user) });
const idsOf = (response) => (response.body.medicalRecords ?? []).map((row) => String(row._id)).sort();
const sorted = (ids) => ids.map(String).sort();

(async () => {
  let failed = false;
  try {
    await h.setupWithFixtures();
    await require("../../services/immunization/initialize").initializeImmunization();

    const [admin, bhw, midwife] = await Promise.all(["admin", "bhw", "midwife"].map(h.createStaff));
    const ana = await linkAccount(await h.createStaff("resident"), "TEST-F");
    const bea = await linkAccount(await h.createStaff("resident"), "TEST-A");
    const unlinked = await h.createStaff("resident");
    const unverified = await linkAccount(await h.createStaff("resident"), "TEST-B1", {
      verified: true, status: "active", verificationMethod: "auto",
    });

    const encodeFor = async (masterResidentId, visitDate) => {
      const made = await h.encode(bhw, h.bpRecord({ masterResidentId, visitDate }));
      assert.equal(made.status, 201, h.json(made));
      return String(made.body.record?._id ?? made.body.medicalRecord?._id ?? made.body.detail?._id);
    };
    const anaRecord = await encodeFor("TEST-F", "2024-03-15");
    const beaRecord = await encodeFor("TEST-A", "2024-03-16");
    const unverifiedRecord = await encodeFor("TEST-B1", "2024-03-17");

    // A completed visit that belongs to Bea by her own account, with no master link involved.
    // Written directly: this test is about reading the record, not booking the visit.
    const visit = { _id: new mongoose.Types.ObjectId(), completedAt: new Date("2024-05-01T01:30:00Z") };
    await Appointment.collection.insertOne({
      ...visit, resident: bea._id, consultationType: "bp_checking", status: "completed",
      slotStart: new Date("2024-05-01T01:00:00Z"), slotEnd: new Date("2024-05-01T01:30:00Z"),
    });
    const beaVisit = await MedicalRecord.create({
      appointment: visit._id, resident: bea._id, provider: bhw._id, providerRole: "bhw", serviceType: "bp_checking",
      completedAt: visit.completedAt, assessment: "Fictional assessment", notes: "Staff-only visit note",
    });

    const makeBaby = async (mother, key) => (await immunization("/babies", midwife, {
      motherMasterResidentId: mother, dateOfBirth: "2026-01-01", requestKey: key,
    })).body.baby;
    const anaBaby = await makeBaby("TEST-F", "own-ana");
    const anaNewborn = await makeBaby("TEST-F", "own-ana-newborn");
    const beaBaby = await makeBaby("TEST-A", "own-bea");
    const unverifiedBaby = await makeBaby("TEST-B1", "own-unverified");
    const giveDose = (mother, baby) => immunization("/administrations", midwife, {
      motherMasterResidentId: mother, babyId: baby._id, doseKey: "bcg-1",
      administeredOn: "2026-01-01", historical: true, administeredBy: "Fictional historical clinician",
    });
    await giveDose("TEST-F", anaBaby);
    await giveDose("TEST-A", beaBaby);
    await giveDose("TEST-B1", unverifiedBaby);
    const programOf = async (baby) => String((await MedicalRecord.findOne({ immunizationBabyId: baby._id }).lean())._id);
    const anaProgram = await programOf(anaBaby);
    const beaProgram = await programOf(beaBaby);
    const anaOwn = sorted([anaRecord, anaProgram]);

    // The list holds only the signed-in resident's records, and its count agrees.
    const mine = await h.myRecordPage(ana);
    assert.deepEqual(idsOf(mine), anaOwn, h.json(mine));
    assert.equal(mine.body.total, 2, "the total counts only her records");
    assert.deepEqual(sorted((await h.myRecords(ana)).body.medicalRecords.map((row) => row._id)), anaOwn);
    for (const row of mine.body.medicalRecords) {
      for (const hidden of ["notes", "masterResidentId", "revisions", "createdBy", "workflowStatus"]) {
        assert.equal(row[hidden], undefined, `a resident row never carries ${hidden}`);
      }
    }

    // Nothing in the request body can widen the list.
    const tampered = [
      { masterResidentId: "TEST-A" },
      { resident: String(bea._id), userId: String(bea._id) },
      { $or: [{}] },
      { service: { $ne: null } },
      { query: ".*" },
      { query: { $ne: null } },
      { range: "constructor" },
      { range: { $gt: "" } },
      { before: { completedAt: "2999-01-01", id: beaRecord } },
    ];
    for (const body of tampered) {
      const page = await h.myRecordPage(ana, body);
      assert.equal(page.status, 200, `${h.json(body)} ${h.json(page)}`);
      assert.ok(idsOf(page).every((id) => anaOwn.includes(id)), `body ${h.json(body)} widened the list`);
      assert.ok(!idsOf(page).includes(beaRecord) && !idsOf(page).includes(beaProgram));
    }
    const otherBaby = await h.myRecordPage(ana, { babyId: beaBaby._id });
    assert.deepEqual(idsOf(otherBaby), [], "another mother's baby matches nothing");
    assert.equal(otherBaby.body.total, 0, "and the total reveals nothing");
    const invalidBaby = await h.myRecordPage(ana, { babyId: { $ne: null } });
    assert.deepEqual(idsOf(invalidBaby), [], "a malformed baby ID matches nothing, never everything");
    assert.deepEqual(idsOf(await h.myRecordPage(ana, { babyId: anaBaby._id })), [anaProgram]);

    // Direct reads: her own open, everyone else's are refused, by record or appointment ID.
    assert.equal((await open(ana, anaRecord)).status, 200);
    assert.equal((await open(ana, anaProgram)).status, 200);
    assert.equal((await open(ana, beaRecord)).status, 403);
    assert.equal((await open(ana, beaProgram)).status, 403);
    assert.equal((await open(ana, beaVisit._id)).status, 403);
    assert.equal((await open(ana, visit._id)).status, 403, "the appointment ID is no way around it");
    const ownVisit = await open(bea, beaVisit._id);
    assert.equal(ownVisit.status, 200);
    assert.equal(ownVisit.body.medicalRecord.notes, undefined, "the care team's notes stay private");
    assert.ok(idsOf(await h.myRecordPage(bea)).includes(String(beaVisit._id)), "her visit is on her own list");

    // A former clinician now on a resident account keeps no access through authorship or service.
    // A resident session needs a device, so the account is made a resident and the record names it as author.
    const demoted = await h.createStaff("resident");
    await MedicalRecord.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(beaRecord) },
      { $set: { provider: demoted._id, createdBy: demoted._id } }
    );
    const stored = await MedicalRecord.findById(beaRecord).lean();
    assert.equal(String(stored.provider), String(demoted._id), "the fixture really names them as provider");
    const demotedList = await h.myRecordPage(demoted);
    assert.equal(demotedList.status, 200, `the demoted account can sign in and read its own list: ${h.json(demotedList).slice(0, 300)}`);
    const demotedRead = await open(demoted, beaRecord);
    assert.equal(demotedRead.status, 403, `authoring a record is not owning it once on a resident account: ${h.json(demotedRead).slice(0, 400)}`);

    // No link means her own visits only: empty, never everything.
    const none = await h.myRecordPage(unlinked);
    assert.deepEqual(idsOf(none), []);
    assert.equal(none.body.total, 0);
    assert.deepEqual(none.body.babiesWithoutRecords, []);
    assert.equal((await open(unlinked, anaRecord)).status, 403);

    // An account link that is not verified reaches paper records (kape's decision) but never a baby's ledger.
    const partial = await h.myRecordPage(unverified);
    assert.deepEqual(idsOf(partial), [unverifiedRecord]);
    assert.deepEqual(partial.body.babiesWithoutRecords, []);
    assert.equal((await open(unverified, await programOf(unverifiedBaby))).status, 403);

    // A registered baby with no doses has no record yet. Only its own mother learns of it.
    const anaBabies = (await h.myRecordPage(ana)).body.babiesWithoutRecords;
    assert.deepEqual(anaBabies.map((baby) => baby._id), [anaNewborn._id]);
    assert.deepEqual(Object.keys(anaBabies[0]).sort(), ["_id", "dateOfBirth", "name", "temporaryName"].sort());
    assert.deepEqual((await h.myRecordPage(bea)).body.babiesWithoutRecords, []);

    // The dose ledger ignores any mother the request names.
    const asAna = { motherMasterResidentId: "TEST-A" };
    assert.equal((await immunization("/checklist", ana, { ...asAna, babyId: beaBaby._id })).status, 403);
    const babies = await immunization("/babies/search", ana, asAna);
    assert.ok(babies.body.babies.every((baby) => baby.motherMasterResidentId !== "TEST-A"), h.json(babies));
    assert.equal((await immunization("/visits/doses", ana, { recordId: beaProgram })).status, 403);

    // Staff routes stay closed to residents.
    const headers = h.asResident(ana);
    const refused = [
      h.request("/medical-record-masterlist/search", { method: "POST", body: {}, headers }),
      h.request("/medical-record-masterlist/summary", { headers }),
      h.request("/medical-record-masterlist/identities/search", { method: "POST", body: { query: "Test" }, headers }),
      h.request(`/medical-record-masterlist/${beaRecord}`, { headers }),
      h.request("/appointments/completed", { headers }),
      h.request("/medical-record-masterlist", { method: "POST", body: h.bpRecord(), headers }),
      h.request(`/medical-record-masterlist/${anaRecord}`, { method: "PATCH", body: { reason: "x" }, headers }),
      h.request("/medical-record-masterlist/delete", { method: "POST", body: { recordId: anaRecord, reason: "x" }, headers }),
    ];
    for (const response of await Promise.all(refused)) assert.equal(response.status, 403, h.json(response));

    // Residents read pages by number, and every page stays inside their own records.
    await MedicalRecord.insertMany(Array.from({ length: 23 }, (_, index) => ({
      masterResidentId: "TEST-F", serviceType: "bp_checking", source: "historical_masterlist",
      completedAt: new Date(Date.UTC(2020, 0, index + 1)), providerName: "Fictional BHW", providerRole: "bhw",
    })));
    const first = await h.myRecordPage(ana, { page: 1 });
    const second = await h.myRecordPage(ana, { page: 2 });
    assert.equal(first.body.medicalRecords.length, 20);
    assert.equal(second.body.medicalRecords.length, 5);
    assert.equal(second.body.total, 25);
    assert.equal(new Set([...idsOf(first), ...idsOf(second)]).size, 25, "pages do not overlap");
    assert.ok(!idsOf(second).includes(beaRecord));
    assert.equal((await h.myRecordPage(ana, { page: -3 })).body.medicalRecords.length, 20, "a bad page reads as the first");

    // Admin and service staff keep the access they had.
    const adminList = await h.search(admin, {});
    assert.equal(adminList.status, 200);
    assert.ok(adminList.body.records.some((row) => String(row._id) === beaRecord));
    assert.ok(adminList.body.records.some((row) => String(row._id) === anaRecord));
    const adminRead = await open(admin, beaRecord);
    assert.equal(adminRead.status, 200);
    assert.ok(adminRead.body.medicalRecord.notes, "staff still see the care team's notes");
    assert.equal((await open(bhw, anaRecord)).status, 200);
    console.log("medical record ownership: all checks passed");
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await h.finish(failed);
  }
})();
