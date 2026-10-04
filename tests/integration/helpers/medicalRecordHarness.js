"use strict";

// Shared setup for the Medical Records Masterlist tests, on top of the master
// list harness. Every person and reading here is invented.

const User = require("../../../models/User");
const MasterResident = require("../../../models/MasterResident");
const MedicalRecord = require("../../../models/MedicalRecord");
const harness = require("./masterListHarness");

const { request, tokenFor, MASTER_FIXTURES } = harness;

const WEB = { "X-Client-Platform": "web" };
const MOBILE_RESIDENT = { "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.9.2" };

let staffSeq = 0;
const createStaff = (role) => {
  staffSeq += 1;
  return User.create({
    fullname: `Test ${role} ${staffSeq}`,
    email: `${role}.${staffSeq}@maslogcare.test`,
    password: "TestPassword123!",
    role,
    verified: true,
    status: "approved",
    phone: "09170000000",
    gender: "female",
    dateOfBirth: new Date("1980-01-01T00:00:00.000Z"),
    address: "Test address",
    approved_at: new Date(),
  });
};

const as = (user) => ({ Authorization: `Bearer ${tokenFor(user, "web")}`, ...WEB });
const asResident = (user) => ({ Authorization: `Bearer ${tokenFor(user, "mobile")}`, ...MOBILE_RESIDENT });

const bpRecord = (overrides = {}) => ({
  masterResidentId: "TEST-F",
  serviceType: "bp_checking",
  source: "historical_masterlist",
  visitDate: "2024-03-15",
  providerName: "BHW on duty",
  providerRole: "bhw",
  visitReason: "Routine BP check",
  record: { notes: "Staff-only note", serviceDetails: { systolic: 130, diastolic: 85, pulseRate: 72 } },
  ...overrides,
});

const encode = (user, body) =>
  request("/medical-record-masterlist", { method: "POST", body, headers: as(user) });

const search = (user, body = {}) =>
  request("/medical-record-masterlist/search", { method: "POST", body, headers: as(user) });

const myRecords = (resident) => request("/medical-records/me", { headers: asResident(resident) });

const myRecordPage = (resident, body = {}) =>
  request("/medical-records/me/search", { method: "POST", body, headers: asResident(resident) });

const setupWithFixtures = async () => {
  await harness.setup();
  await Promise.all([MedicalRecord.init(), MasterResident.create(MASTER_FIXTURES)]);
};

const finish = async (failedHard) => {
  await harness.teardown();
  const { passed, failed, failures } = harness.summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0 || failedHard) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
};

module.exports = {
  ...harness,
  createStaff,
  as,
  asResident,
  bpRecord,
  encode,
  search,
  myRecords,
  myRecordPage,
  setupWithFixtures,
  finish,
};
