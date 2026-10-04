"use strict";

// Medical Records Masterlist, staff side: who may encode and see what,
// validation, duplicate warnings, retries and edit history.

const MedicalRecord = require("../../models/MedicalRecord");
const SystemLog = require("../../models/SystemLog");
const h = require("./helpers/medicalRecordHarness");

const { check, json, request, as, bpRecord, encode, search } = h;

async function authorization(staff) {
  console.log("\nOnly staff reach the masterlist, each within their own services");
  const anonymous = await request("/medical-record-masterlist/search", { method: "POST", body: {} });
  check("signed-out request is refused (401)", anonymous.status === 401, `got ${anonymous.status}`);

  const resident = await h.createStaff("resident");
  const asResident = await request("/medical-record-masterlist/summary", { headers: h.asResident(resident) });
  check("a resident is refused (403)", asResident.status === 403, `got ${asResident.status}`);

  const doctorBp = await encode(staff.doctor, bpRecord());
  check("a doctor cannot encode a BP checking record (403)", doctorBp.status === 403, json(doctorBp));
}

async function encoding(staff) {
  console.log("\nEncoding a historical record for someone without an account");
  const created = await encode(staff.bhw, bpRecord({ requestKey: "key-1" }));
  check("the BHW saves a BP record (201)", created.status === 201, json(created));
  const detail = created.body.detail;
  check("it is not linked to any account", detail?.linkage === "unlinked", detail?.linkage);
  check("the resident identity is shown", detail?.resident?.masterResidentId === "TEST-F");
  check("the encoder is recorded", detail?.audit?.createdByRole === "bhw");

  const retry = await encode(staff.bhw, bpRecord({ requestKey: "key-1" }));
  check(
    "a retry with the same key returns the same record (200)",
    retry.status === 200 && retry.body.detail?._id === detail?._id,
    json(retry)
  );

  const duplicate = await encode(staff.bhw, bpRecord());
  check("the same visit again is flagged (409)", duplicate.status === 409, json(duplicate));
  check("the flag names the existing record", duplicate.body.existingRecordIds?.includes(detail?._id));
  check("the warning has no personal details", !/Fern|Linked|130/.test(duplicate.body.message ?? ""));

  const confirmed = await encode(staff.bhw, bpRecord({ confirmDuplicate: true }));
  check("staff may confirm and save anyway (201)", confirmed.status === 201, json(confirmed));
  check("the confirmation is kept on the record", confirmed.body.detail?.audit?.duplicateAcknowledged === true);
  return detail;
}

async function validation(staff) {
  console.log("\nBad input is refused without echoing it");
  const cases = [
    ["a future date", bpRecord({ visitDate: "2999-01-01" })],
    ["a malformed date", bpRecord({ visitDate: "03/15/2024" })],
    ["a forged appointment source", bpRecord({ source: "appointment" })],
    ["an inactive resident", bpRecord({ masterResidentId: "TEST-D" })],
    ["an unknown resident", bpRecord({ masterResidentId: "NOPE-1" })],
    ["a reading out of range", bpRecord({ record: { serviceDetails: { systolic: 999, diastolic: 80 } } })],
    ["a visit before birth", bpRecord({ visitDate: "1990-01-01" })],
    ["no medical detail", bpRecord({ record: {} })],
  ];
  for (const [label, body] of cases) {
    const response = await encode(staff.bhw, body);
    check(`${label} is refused`, [400, 422].includes(response.status), `${response.status} ${json(response)}`);
  }
  const unknownService = await encode(staff.admin, bpRecord({ serviceType: "surgery" }));
  check("an unknown service is refused (400)", unknownService.status === 400, json(unknownService));
}

async function scopeAndSummary(staff) {
  console.log("\nLists and counts follow service ownership");
  const prenatal = await encode(staff.midwife, {
    ...bpRecord({ serviceType: "prenatal", providerRole: "midwife", visitDate: "2024-05-01" }),
    record: { assessment: "Normal visit", serviceDetails: {} },
  });
  check("the midwife saves a prenatal record", prenatal.status === 201, json(prenatal));

  const bhwList = await search(staff.bhw);
  check(
    "the BHW list holds BP records only",
    bhwList.status === 200 && bhwList.body.records.every((row) => row.serviceType === "bp_checking"),
    json(bhwList)
  );
  const adminList = await search(staff.admin);
  check("the admin list holds every service", adminList.body.pagination?.total === 3, json(adminList));

  const prenatalId = prenatal.body.detail?._id;
  const blocked = await request(`/medical-record-masterlist/${prenatalId}`, { headers: as(staff.bhw) });
  check("the BHW cannot open a prenatal record (403)", blocked.status === 403, `got ${blocked.status}`);

  const summary = await request("/medical-record-masterlist/summary", { headers: as(staff.admin) });
  const counts = summary.body.summary ?? {};
  check("summary total matches the list", counts.total === 3, json(summary));
  check("all three are unlinked", counts.unlinked === 3 && counts.linked === 0, json(summary));

  const unlinkedList = await search(staff.admin, { linkage: "unlinked" });
  check("the unlinked card opens the same three", unlinkedList.body.pagination?.total === counts.unlinked);

  const byName = await search(staff.admin, { search: "Fern" });
  check("search by name finds the records", byName.body.pagination?.total === 3, json(byName));
  const history = await search(staff.admin, { masterResidentId: "TEST-F" });
  check(
    "one resident's history counts records per service",
    history.body.serviceCounts?.bp_checking === 2 && history.body.serviceCounts?.prenatal === 1,
    json(history)
  );
}

async function editing(staff, record) {
  console.log("\nEdits keep the earlier values");
  const path = `/medical-record-masterlist/${record._id}`;
  const edit = { ...bpRecord(), record: { notes: "Staff-only note", serviceDetails: { systolic: 128, diastolic: 85, pulseRate: 72 } } };

  const noReason = await request(path, { method: "PATCH", body: edit, headers: as(staff.bhw) });
  check("an edit without a reason is refused", [400, 422].includes(noReason.status), json(noReason));

  const otherBhw = await h.createStaff("bhw");
  const stranger = await request(path, { method: "PATCH", body: { ...edit, reason: "Typo" }, headers: as(otherBhw) });
  check("another BHW cannot edit it (403)", stranger.status === 403, json(stranger));

  const updated = await request(path, { method: "PATCH", body: { ...edit, reason: "Typo on the card" }, headers: as(staff.bhw) });
  check("the encoder edits with a reason", updated.status === 200, json(updated));
  const revision = updated.body.detail?.revisions?.[0];
  check(
    "the revision keeps the earlier reading",
    revision?.changes?.some((change) => change.field === "serviceDetails.systolic" && change.previous === 130),
    json(updated)
  );

  const log = await SystemLog.findOne({ action: "MEDICAL_RECORD_UPDATED" }).lean();
  check("the edit is audited by field name only", log?.metadata?.fields?.includes("serviceDetails.systolic"));
  check("the audit holds no reading", !JSON.stringify(log?.metadata ?? {}).includes("128"));
}

(async () => {
  let crashed = false;
  try {
    await h.setupWithFixtures();
    const staff = {
      admin: await h.createStaff("admin"),
      doctor: await h.createStaff("doctor"),
      midwife: await h.createStaff("midwife"),
      bhw: await h.createStaff("bhw"),
    };
    await authorization(staff);
    const record = await encoding(staff);
    await validation(staff);
    await scopeAndSummary(staff);
    await editing(staff, record);
    check("records are never deleted", (await MedicalRecord.countDocuments()) === 3);
  } catch (error) {
    crashed = true;
    console.log(`  FAIL  suite crashed: ${error?.stack}`);
  } finally {
    await h.finish(crashed);
  }
})();
