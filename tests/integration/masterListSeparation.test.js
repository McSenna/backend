"use strict";

// The Barangay Master List and user accounts are separate data sets. These
// checks drive the real API and compare both collections before and after each
// kind of write. Every person here is invented test data.

const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const harness = require("./helpers/masterListHarness");

const { check, request, json, tokenFor, asAdmin, register, MOBILE } = harness;

const snapshot = async (Model) => JSON.stringify(await Model.find().sort({ _id: 1 }).lean());
const BASE = "/admin/master-residents";

const officialRow = (overrides = {}) => ({
  firstName: "Sepa",
  middleName: "Sample",
  lastName: "Ration",
  dateOfBirth: "1992-08-08",
  sex: "female",
  civilStatus: "single",
  address: "Purok 7, Kalachuchi Street",
  ...overrides,
});

async function authorization(doctor, resident, recordId) {
  console.log("\nOnly admins reach the master list");
  const residentLogin = await request("/login", { method: "POST", body: { email: resident.email, password: "TestPass123!" }, headers: MOBILE });
  const asResident = { ...MOBILE, Authorization: `Bearer ${residentLogin.body.token}` };
  const asDoctor = { Authorization: `Bearer ${tokenFor(doctor)}`, "X-Client-Platform": "web" };
  const calls = [
    ["GET", BASE],
    ["GET", `${BASE}/${recordId}`],
    ["POST", BASE],
    ["POST", `${BASE}/import`],
    ["PATCH", `${BASE}/${recordId}`],
    ["PATCH", `${BASE}/${recordId}/status`],
  ];
  for (const [method, path] of calls) {
    const body = method === "GET" ? undefined : {};
    const anonymous = await request(path, { method, body });
    const fromResident = await request(path, { method, body, headers: asResident });
    const fromDoctor = await request(path, { method, body, headers: asDoctor });
    check(`${method} ${path.replace(recordId, ":id")} refuses anonymous callers`, anonymous.status === 401, `got ${anonymous.status}`);
    check(`${method} ${path.replace(recordId, ":id")} refuses residents`, fromResident.status === 403, `got ${fromResident.status}`);
    check(`${method} ${path.replace(recordId, ":id")} refuses other staff`, fromDoctor.status === 403, `got ${fromDoctor.status}`);
  }
}

async function masterWritesLeaveAccountsAlone(admin, linked) {
  console.log("\nMaster list writes never touch accounts");
  const usersBefore = await snapshot(User);

  const created = await request(BASE, {
    method: "POST",
    headers: asAdmin(admin),
    body: { ...officialRow(), role: "admin", isActive: false, createdBy: String(linked._id), email: "smuggle@test" },
  });
  check("an admin can add a record", created.status === 201, json(created));
  check("the role is always resident", created.body.record?.role === "resident");
  check("status cannot be set on create", created.body.record?.isActive === true);
  check("an ID is generated when none is given", /^MSL-[0-9A-F]{8}$/.test(created.body.record?.masterResidentId ?? ""));
  check("a new record has no account", created.body.record?.linkedAccount === false);

  const invalid = await request(BASE, {
    method: "POST",
    headers: asAdmin(admin),
    body: officialRow({ lastName: "", dateOfBirth: "08/08/1992", sex: "unknown" }),
  });
  const fieldErrors = invalid.body.fieldErrors ?? {};
  check("invalid records are refused field by field", invalid.status === 422 && ["lastName", "dateOfBirth", "sex"].every((key) => key in fieldErrors), json(invalid));
  check("a badly formatted birth date says how to fix it", /YYYY-MM-DD/.test(fieldErrors.dateOfBirth ?? ""));
  check("errors never echo the submitted values", !json(invalid).includes("08/08/1992"));

  const linkedRecord = await MasterResident.findOne({ masterResidentId: "TEST-A" }).lean();
  const edited = await request(`${BASE}/${linkedRecord._id}`, {
    method: "PATCH",
    headers: asAdmin(admin),
    body: { address: "Purok 9, New Street", firstName: "Renamed", masterResidentId: "HIJACK-1" },
  });
  check("an admin can edit a record", edited.status === 200 && edited.body.record?.firstName === "Renamed", json(edited));
  check("the record ID cannot change", edited.body.record?.masterResidentId === "TEST-A");

  const deactivated = await request(`${BASE}/${linkedRecord._id}/status`, { method: "PATCH", headers: asAdmin(admin), body: { active: false } });
  check("an admin can deactivate a record", deactivated.body.record?.isActive === false, json(deactivated));
  const badStatus = await request(`${BASE}/${linkedRecord._id}/status`, { method: "PATCH", headers: asAdmin(admin), body: { active: "no" } });
  check("status must be true or false", badStatus.status === 400);

  const imported = await request(`${BASE}/import`, {
    method: "POST",
    headers: asAdmin(admin),
    body: { records: [officialRow({ masterResidentId: "IMP-1" }), officialRow({ masterResidentId: "IMP-2", firstName: "Second" })] },
  });
  check("an admin can import records", imported.status === 201 && imported.body.imported === 2, json(imported));

  const countBefore = await MasterResident.countDocuments();
  const partial = await request(`${BASE}/import`, {
    method: "POST",
    headers: asAdmin(admin),
    body: { records: [officialRow({ masterResidentId: "IMP-3" }), officialRow({ masterResidentId: "IMP-1" }), officialRow({ masterResidentId: "IMP-4", sex: "" })] },
  });
  check("one bad row stops the whole import", partial.status === 400 && (await MasterResident.countDocuments()) === countBefore, json(partial));
  check("the import names the rows to fix", JSON.stringify(partial.body.rowErrors?.map((row) => row.row)) === "[2,3]");

  check("no account was created, changed or removed", (await snapshot(User)) === usersBefore);
  const linkedAfter = await User.findById(linked._id).lean();
  check("the linked account keeps its own name", linkedAfter.firstName === linked.firstName);
  check("the linked account stays signed-in ready", linkedAfter.status === "approved" && linkedAfter.masterResidentId === "TEST-A");
}

async function accountWritesLeaveMasterListAlone(admin, linked) {
  console.log("\nAccount writes never touch the master list");
  const masterBefore = await snapshot(MasterResident);

  const unmatched = await register({ firstName: "Nobody", surname: "Listed", dateOfBirth: "1995-05-05" });
  check("an unmatched sign-up is a pending account", unmatched.user?.status === "pending");
  check("an account can exist without a master record", unmatched.user?.masterResidentId === undefined);

  const login = await request("/login", { method: "POST", body: { email: linked.email, password: "TestPass123!" }, headers: MOBILE });
  const edit = await request("/profile", {
    method: "PATCH",
    headers: { ...MOBILE, Authorization: `Bearer ${login.body.token}` },
    body: { firstName: "Edited", surname: "Elsewhere", dateOfBirth: "1991-01-01", address: "Purok 2, Other Road" },
  });
  check("a linked resident can edit their profile", edit.status === 200, json(edit));

  const approve = await request(`/admin/user-requests/${unmatched.verification._id}/approve`, { method: "PATCH", headers: asAdmin(admin) });
  check("an admin can approve an unmatched account", approve.status === 200, json(approve));
  const approved = await User.findById(unmatched.user._id).lean();
  check("approval without a match links nothing", approved.status === "approved" && approved.masterResidentId === undefined);

  const suspend = await request(`/users/${linked._id}/status`, { method: "PATCH", headers: asAdmin(admin), body: { status: "deactivated" } });
  check("an admin can deactivate a linked account", suspend.status === 200, json(suspend));

  check("no master record was created, changed or removed", (await snapshot(MasterResident)) === masterBefore);
}

(async () => {
  console.log("\n--- Testing Master List and account separation ---");
  try {
    await harness.setup();
    delete process.env.MASTER_LIST_AUTO_VERIFY;
    await MasterResident.create(harness.MASTER_FIXTURES);
    const admin = await User.create({ fullname: "Test Admin", email: "admin@maslogcare.test", password: "TestPass123!", role: "admin", status: "active", verified: true, gender: "female", dateOfBirth: new Date("1980-01-01"), address: "Barangay Hall" });
    const doctor = await User.create({ fullname: "Test Doctor", email: "doctor@maslogcare.test", password: "TestPass123!", role: "doctor", status: "active", verified: true, gender: "male", dateOfBirth: new Date("1980-01-01"), address: "Clinic" });

    console.log("\nDefault policy");
    const masterBefore = await snapshot(MasterResident);
    const matched = await register({});
    check("a clean match is verified by default", matched.user?.status === "approved" && matched.user?.verificationMethod === "master_list", JSON.stringify(matched.user?.status));
    check("registration created no master record", (await snapshot(MasterResident)) === masterBefore);
    check("the public response carries no master data", Object.keys(matched.response.body).sort().join() === "email,message,status,success,userId");

    const unlinkedRecord = await MasterResident.findOne({ masterResidentId: "TEST-F" }).lean();
    const list = await request(`${BASE}?status=all&search=fern`, { headers: asAdmin(admin) });
    check("a master record can exist without an account", list.body.records?.[0]?.linkedAccount === false && list.body.records?.[0]?._id === String(unlinkedRecord._id), json(list));

    await authorization(doctor, matched.user, String(unlinkedRecord._id));
    await masterWritesLeaveAccountsAlone(admin, matched.user);
    await accountWritesLeaveMasterListAlone(admin, matched.user);
  } catch (error) {
    check("suite ran without crashing", false, error.stack || error.message);
  } finally {
    await harness.teardown();
  }

  const { passed, failed, failures } = harness.summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
})();
