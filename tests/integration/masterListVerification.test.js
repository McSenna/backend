"use strict";

const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const ResidentVerification = require("../../models/ResidentVerification");
const { createResidentAccount } = require("../../services/auth/registrationDecision");
const harness = require("./helpers/masterListHarness");

const { check, request, json, setAutoVerify, tokenFor, asAdmin, register, MOBILE } = harness;

const PUBLIC_KEYS = ["email", "message", "status", "success", "userId"];
const publicKeysOf = (response) => Object.keys(response.body).sort().join(",");

const login = (email) =>
  request("/login", {
    method: "POST",
    body: { email, password: "TestPass123!" },
    headers: MOBILE,
  });

async function policyOff() {
  console.log("\nPolicy off (default): a match is recorded but still reviewed");
  setAutoVerify(false);

  const matched = await register({});
  check("registration is accepted", matched.response.status === 201, json(matched.response));
  check("account stays pending", matched.user?.status === "pending", matched.user?.status);
  check("method is admin review", matched.user?.verificationMethod === "admin_review");
  check("no master record is linked yet", matched.user?.masterResidentId === undefined);
  check(
    "the check found the one record",
    matched.verification?.masterListCheck?.outcome === "matched" &&
      matched.verification.masterListCheck.candidateIds.join() === "TEST-A",
    JSON.stringify(matched.verification?.masterListCheck)
  );

  const stranger = await register({ firstName: "Nobody", surname: "Known", dateOfBirth: "1993-03-03" });
  check("a stranger is pending too", stranger.user?.status === "pending");
  check("a stranger's check says no match", stranger.verification?.masterListCheck?.outcome === "no_match");
  check(
    "match and no match get the same public response",
    publicKeysOf(matched.response) === PUBLIC_KEYS.join() &&
      publicKeysOf(stranger.response) === PUBLIC_KEYS.join() &&
      matched.response.body.message === stranger.response.body.message &&
      matched.response.body.status === "pending",
    `${json(matched.response)} vs ${json(stranger.response)}`
  );

  const blocked = await login(matched.email);
  check("a pending account cannot sign in", blocked.status === 403, `got ${blocked.status}`);
  return matched;
}

async function policyOn() {
  console.log("\nPolicy on: only one clean match verifies");
  setAutoVerify(true);

  const verified = await register({});
  check("a clean match is approved", verified.user?.status === "approved", verified.user?.status);
  check("the method is master list", verified.user?.verificationMethod === "master_list");
  check("the record is linked", verified.user?.masterResidentId === "TEST-A");
  check("the system, not an admin, approved", verified.user?.approved_by === null && Boolean(verified.user?.approved_at));
  check(
    "the review record is closed by the system",
    verified.verification?.verificationStatus === "approved" &&
      verified.verification?.verificationMethod === "master_list" &&
      verified.verification?.verifiedBy === null &&
      Boolean(verified.verification?.verifiedAt)
  );
  check("the response says approved", verified.response.body.status === "approved", json(verified.response));
  const signedIn = await login(verified.email);
  check("the verified resident can sign in", signedIn.status === 200, json(signedIn));

  const again = await register({});
  check("a second account for the same record waits for review", again.user?.status === "pending");
  check("it is flagged as already linked", again.verification?.masterListCheck?.outcome === "already_linked");

  const twins = await register({ firstName: "Duo", surname: "Twin", dateOfBirth: "1985-01-01", sex: "male", address: { houseNumberOrPurok: "Purok 1", street: "Acacia Street" } });
  check("two possible records are never picked between", twins.user?.status === "pending");
  check("they are reported as multiple matches", twins.verification?.masterListCheck?.outcome === "multiple_matches");

  const inactive = await register({ firstName: "Gone", middleName: "", surname: "Away", dateOfBirth: "1970-02-02", sex: "male", address: { houseNumberOrPurok: "Purok 2", street: "Narra Street" } });
  check("inactive records are ignored", inactive.verification?.masterListCheck?.outcome === "no_match");

  const elsewhere = await register({ firstName: "Other", middleName: "", surname: "Place", dateOfBirth: "1999-09-09", address: { houseNumberOrPurok: "Purok 9", street: "Faraway Road", barangay: "Elsewhere" } });
  check("records in another barangay are ignored", elsewhere.verification?.masterListCheck?.outcome === "no_match");

  const wrongSex = await register({ firstName: "Fern", surname: "Linked", dateOfBirth: "2001-07-20", sex: "male", address: { houseNumberOrPurok: "Purok 4", street: "Molave St" } });
  check("a conflicting field is never auto-verified", wrongSex.user?.status === "pending");
  check("and is reported as a conflict", wrongSex.verification?.masterListCheck?.outcome === "conflict");
  return { wrongSex };
}

async function trustedFieldsIgnored() {
  console.log("\nClient-supplied verification fields are ignored");
  const forged = await register(
    { firstName: "Forge", surname: "Attempt", dateOfBirth: "1994-05-05" },
    {
      status: "approved",
      verified: true,
      verificationStatus: "VERIFIED",
      verificationMethod: "master_list",
      masterResidentId: "TEST-F",
      role: "admin",
    }
  );
  check("forged fields cannot verify", forged.user?.status === "pending" && forged.user?.verified === false);
  check("forged fields cannot link", forged.user?.masterResidentId === undefined);
  check("forged fields cannot change the role", forged.user?.role === "resident");
}

async function raceFallback() {
  console.log("\nRace: a record linked between the check and the save");
  setAutoVerify(true);
  const staleCheck = { outcome: "matched", reasons: [], candidateIds: ["TEST-A"], checkedAt: new Date() };
  const { user, decision, masterListCheck } = await createResidentAccount({
    accountFields: {
      fullname: "Race Test", firstName: "Race", surname: "Test", email: "race@maslogcare.test",
      password: "TestPass123!", gender: "female", dateOfBirth: new Date("1990-04-12"),
      address: "Purok 3", role: "resident",
    },
    masterListCheck: staleCheck,
  });
  check("the losing sign-up is still created", Boolean(user?._id));
  check("it falls back to admin review", decision.verified === false && user.status === "pending");
  check("it is recorded as already linked", masterListCheck.outcome === "already_linked");
}

async function modelRules() {
  console.log("\nMaster record validation");
  const base = harness.MASTER_FIXTURES[0];
  const attempt = (overrides) =>
    new MasterResident({ ...base, masterResidentId: "TEST-V1", ...overrides }).validate().then(
      () => null,
      (error) => Object.keys(error.errors ?? {})
    );
  check("first name is required", (await attempt({ firstName: "" }))?.includes("firstName"));
  check("sex must be a known value", (await attempt({ sex: "unknown" }))?.includes("sex"));
  check("civil status must be a known value", (await attempt({ civilStatus: "complicated" }))?.includes("civilStatus"));
  check("birth dates must be calendar dates", (await attempt({ dateOfBirth: new Date("1990-04-12T08:30:00Z") }))?.includes("dateOfBirth"));
  check("future birth dates are refused", (await attempt({ dateOfBirth: new Date("2999-01-01T00:00:00Z") }))?.includes("dateOfBirth"));
  check("a namesake with the same birthday is allowed", (await attempt({})) === null);
  const duplicateId = await MasterResident.create({ ...base }).then(() => false, (error) => error.code === 11000);
  check("record IDs are unique", duplicateId);
}

async function adminReview(admin, policyOffMatch, wrongSex) {
  console.log("\nAdmin review");
  setAutoVerify(false);
  const doctor = await User.create({ fullname: "Test Doctor", email: "doctor@maslogcare.test", password: "TestPass123!", role: "doctor", status: "active", verified: true, gender: "male", dateOfBirth: new Date("1980-01-01"), address: "Clinic" });

  const path = `/admin/user-requests/${policyOffMatch.verification._id}`;
  check("detail needs a session", (await request(path)).status === 401);
  const asDoctor = await request(path, { headers: { Authorization: `Bearer ${tokenFor(doctor)}`, "X-Client-Platform": "web" } });
  check("detail is admin-only", asDoctor.status === 403, `got ${asDoctor.status}`);

  const detail = await request(path, { headers: asAdmin(admin) });
  const masterList = detail.body.request?.masterList;
  check("detail includes the master list check", masterList?.outcome === "matched", json(detail));
  check("detail shows the candidate record", masterList?.candidates?.[0]?.firstName === "Testa");

  const list = await request("/admin/user-requests?status=pending", { headers: asAdmin(admin) });
  const row = list.body.requests?.find((item) => item._id === String(policyOffMatch.verification._id));
  check("list rows carry the outcome", row?.masterListOutcome === "matched" && row?.verificationMethod === "admin_review", JSON.stringify(row));

  const approved = await request(`${path}/approve`, { method: "PATCH", headers: asAdmin(admin) });
  const afterApprove = await User.findById(policyOffMatch.user._id).lean();
  check("admin approval succeeds", approved.status === 200, json(approved));
  check("approval records the admin", String(afterApprove.approved_by) === String(admin._id));
  check("a record already linked elsewhere is not linked twice", afterApprove.masterResidentId === undefined);

  const fern = await register({ firstName: "Fern", surname: "Linked", dateOfBirth: "2001-07-20", address: { houseNumberOrPurok: "Purok 4", street: "Molave St" } });
  await request(`/admin/user-requests/${fern.verification._id}/approve`, { method: "PATCH", headers: asAdmin(admin) });
  const fernAfter = await User.findById(fern.user._id).lean();
  check("approving a clean match links the record", fernAfter.masterResidentId === "TEST-F", fernAfter.masterResidentId);
  check("the method stays admin review", fernAfter.verificationMethod === "admin_review");

  const rejected = await request(`/admin/user-requests/${wrongSex.verification._id}/reject`, {
    method: "PATCH",
    headers: asAdmin(admin),
    body: { reason: "Resident verification failed" },
  });
  const rejectedUser = await User.findById(wrongSex.user._id).lean();
  check("admin rejection succeeds", rejected.status === 200, json(rejected));
  check("rejection records who and when", rejectedUser.status === "rejected" && String(rejectedUser.rejected_by) === String(admin._id) && Boolean(rejectedUser.rejected_at));
  return fern;
}

async function masterRecordsUntouched(before, fern) {
  console.log("\nMaster list integrity");
  const login = await request("/login", { method: "POST", body: { email: fern.email, password: "TestPass123!" }, headers: MOBILE });
  const edit = await request("/profile", {
    method: "PATCH",
    headers: { ...MOBILE, Authorization: `Bearer ${login.body.token}` },
    body: { firstName: "Renamed", address: "Purok 8, Elsewhere Street" },
  });
  check("a linked resident can still edit their profile", edit.status === 200, json(edit));

  const after = await MasterResident.find().sort({ masterResidentId: 1 }).lean();
  check("no master record was added or removed", after.length === before.length, `${before.length} -> ${after.length}`);
  check("no master record changed", JSON.stringify(after) === JSON.stringify(before));
}

(async () => {
  console.log("\n--- Testing Barangay Master List verification ---");
  try {
    await harness.setup();
    await MasterResident.create(harness.MASTER_FIXTURES);
    const before = await MasterResident.find().sort({ masterResidentId: 1 }).lean();
    const admin = await User.create({ fullname: "Test Admin", email: "admin@maslogcare.test", password: "TestPass123!", role: "admin", status: "active", verified: true, gender: "female", dateOfBirth: new Date("1980-01-01"), address: "Barangay Hall" });

    const policyOffMatch = await policyOff();
    const { wrongSex } = await policyOn();
    await trustedFieldsIgnored();
    await raceFallback();
    await modelRules();
    const fern = await adminReview(admin, policyOffMatch, wrongSex);
    await masterRecordsUntouched(before, fern);
  } catch (error) {
    check("suite ran without crashing", false, error.stack || error.message);
  } finally {
    delete process.env.MASTER_LIST_AUTO_VERIFY;
    await harness.teardown();
  }

  const { passed, failed, failures } = harness.summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
})();
