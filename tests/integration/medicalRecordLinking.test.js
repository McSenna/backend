"use strict";

// Medical Records Masterlist, account side: records encoded before sign-up
// reach the right account through the master list link, never the wrong one,
// and an unlink hides them without deleting anything.

const MedicalRecord = require("../../models/MedicalRecord");
const User = require("../../models/User");
const h = require("./helpers/medicalRecordHarness");

const { check, json, request, setAutoVerify, register, asAdmin, bpRecord, encode, search } = h;

const seedHistory = (masterResidentId, count, adminId) =>
  MedicalRecord.insertMany(
    Array.from({ length: count }, (_, index) => ({
      source: "historical_masterlist",
      masterResidentId,
      serviceType: "bp_checking",
      // Several records share a day, so paging must break ties by ID.
      completedAt: new Date(Date.UTC(2020, 0, 1 + Math.floor(index / 3))),
      serviceDetails: { systolic: 120, diastolic: 80 },
      notes: "Staff-only note",
      createdBy: adminId,
      createdByRole: "admin",
    }))
  );

async function exactMatch(staff) {
  console.log("\nAn exact match links every record at once");
  await seedHistory("TEST-A", 250, staff.admin._id);
  setAutoVerify(true);
  const signUp = await register({});
  check("the clean match is approved and linked", signUp.user?.masterResidentId === "TEST-A", signUp.user?.status);

  const all = await h.myRecords(signUp.user);
  check("all 250 historical records are visible", all.body.medicalRecords?.length === 250, json(all).slice(0, 200));
  check(
    "staff-only notes and audit fields are stripped",
    all.body.medicalRecords.every((record) => !("notes" in record) && !("createdBy" in record) && !("revisions" in record))
  );

  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const page = await h.myRecordPage(signUp.user, cursor ? { before: cursor } : {});
    page.body.medicalRecords.forEach((record) => seen.add(record._id));
    if (pages === 0) check("the first page reports the total", page.body.total === 250, json(page).slice(0, 200));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 20);
  check("paging covers every record exactly once", seen.size === 250 && pages === 9, `${seen.size} in ${pages} pages`);

  const linked = await search(staff.admin, { masterResidentId: "TEST-A", limit: 1 });
  check("staff see the records as linked", linked.body.records?.[0]?.linkage === "linked", json(linked));

  const again = await register({});
  check("a second sign-up for the same person is not linked", !again.user?.masterResidentId, again.user?.status);
  const stranger = await h.myRecords(again.user);
  check("and sees none of those records", stranger.body.medicalRecords?.length === 0 || stranger.status === 401);
  return signUp.user;
}

async function noMatch() {
  console.log("\nNo match: the account is created with no history");
  const signUp = await register({ firstName: "Nobody", surname: "Known", dateOfBirth: "1993-03-03" });
  check("the account is created", signUp.response.status === 201, json(signUp.response));
  check("nothing is linked", !signUp.user?.masterResidentId);
}

async function ambiguousMatch(staff) {
  console.log("\nTwo possible people: nothing attaches until an admin chooses");
  for (const id of ["TEST-B1", "TEST-B2"]) {
    const saved = await encode(staff.admin, bpRecord({ masterResidentId: id }));
    check(`a record for ${id} is saved`, saved.status === 201, json(saved));
  }
  const signUp = await register({ firstName: "Duo", surname: "Twin", dateOfBirth: "1985-01-01", sex: "male" });
  check("the sign-up waits for review", signUp.user?.status === "pending", signUp.user?.status);

  const pending = await search(staff.admin, { linkage: "pending_review" });
  check("both records show as needing review", pending.body.pagination?.total === 2, json(pending));

  const path = `/admin/user-requests/${signUp.verification._id}/approve`;
  const wrong = await request(path, { method: "PATCH", body: { masterResidentId: "TEST-F" }, headers: asAdmin(staff.admin) });
  check("a record outside the candidates is refused (400)", wrong.status === 400, json(wrong));

  const chosen = await request(path, { method: "PATCH", body: { masterResidentId: "TEST-B1" }, headers: asAdmin(staff.admin) });
  check("the admin approves with TEST-B1", chosen.status === 200 && chosen.body.linkedMasterResidentId === "TEST-B1", json(chosen));

  const user = await User.findById(signUp.user._id).lean();
  const mine = await h.myRecords(user);
  check(
    "the resident sees only TEST-B1's record",
    mine.body.medicalRecords?.length === 1 && mine.body.medicalRecords[0].serviceType === "bp_checking",
    json(mine)
  );
  return user;
}

async function privacy(residentA, residentB) {
  console.log("\nA resident can only open their own records");
  const [recordOfA] = await MedicalRecord.find({ masterResidentId: "TEST-A" }).limit(1).lean();
  const own = await request(`/medical-records/${recordOfA._id}`, { headers: h.asResident(residentA) });
  check("resident A opens their own historical record", own.status === 200, json(own).slice(0, 200));
  const other = await request(`/medical-records/${recordOfA._id}`, { headers: h.asResident(residentB) });
  check("resident B is refused (403)", other.status === 403, `got ${other.status}`);
  const edit = await request(`/medical-record-masterlist/${recordOfA._id}`, {
    method: "PATCH",
    body: { reason: "x" },
    headers: h.asResident(residentA),
  });
  check("a resident cannot edit a record (403)", edit.status === 403, `got ${edit.status}`);
}

async function unlinkAndRelink(staff, resident) {
  console.log("\nUnlink hides the records and deletes nothing");
  const before = await MedicalRecord.countDocuments();
  const base = `/admin/users/${resident._id}`;

  const noReason = await request(`${base}/master-unlink`, { method: "POST", body: {}, headers: asAdmin(staff.admin) });
  check("unlink needs a reason", noReason.status === 400, json(noReason));
  const doctorTry = await request(`${base}/master-unlink`, { method: "POST", body: { reason: "x" }, headers: h.as(staff.doctor) });
  check("a doctor cannot unlink (403)", doctorTry.status === 403, `got ${doctorTry.status}`);

  const unlinked = await request(`${base}/master-unlink`, { method: "POST", body: { reason: "Wrong person" }, headers: asAdmin(staff.admin) });
  check("the admin unlinks", unlinked.status === 200, json(unlinked));
  const hidden = await h.myRecords(resident);
  check("the resident no longer sees them", hidden.body.medicalRecords?.length === 0, json(hidden).slice(0, 200));
  check("no record was deleted", (await MedicalRecord.countDocuments()) === before);

  const taken = await request(`${base}/master-link`, {
    method: "PATCH",
    body: { masterResidentId: "TEST-B1", reason: "Fix" },
    headers: asAdmin(staff.admin),
  });
  check("a record held by another account cannot be linked (409)", taken.status === 409, json(taken));

  const relinked = await request(`${base}/master-link`, {
    method: "PATCH",
    body: { masterResidentId: "TEST-A", reason: "Confirmed in person" },
    headers: asAdmin(staff.admin),
  });
  check("the admin links it again", relinked.status === 200, json(relinked));
  const back = await h.myRecords(resident);
  check("the records are back", back.body.medicalRecords?.length === 250, `${back.body.medicalRecords?.length}`);
}

(async () => {
  let crashed = false;
  try {
    await h.setupWithFixtures();
    const staff = { admin: await h.createStaff("admin"), doctor: await h.createStaff("doctor") };
    const residentA = await exactMatch(staff);
    await noMatch();
    const residentB = await ambiguousMatch(staff);
    await privacy(residentA, residentB);
    await unlinkAndRelink(staff, residentA);
  } catch (error) {
    crashed = true;
    console.log(`  FAIL  suite crashed: ${error?.stack}`);
  } finally {
    await h.finish(crashed);
  }
})();
