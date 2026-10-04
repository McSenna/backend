"use strict";

// Fixtures are invented test people, not residents.
const assert = require("assert");

const { classifyCandidates } = require("../../services/masterList/classifyCandidates");
const {
  strictName,
  looseName,
  suffixKey,
  barangayKey,
  calendarDate,
  addressTokens,
} = require("../../services/masterList/normalize");
const { MATCH_OUTCOMES, MATCH_REASONS } = require("../../config/masterList");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name} — ${error.message}`);
    console.log(`  FAIL  ${name} — ${error.message}`);
  }
}

const record = (overrides = {}) => ({
  masterResidentId: "TEST-0001",
  firstName: "Testa",
  middleName: "Sample",
  lastName: "Fixture",
  suffix: "",
  dateOfBirth: new Date("1990-04-12T00:00:00.000Z"),
  sex: "female",
  address: "Purok 3, Sampaguita St., Barangay Testville",
  ...overrides,
});

const applicant = (overrides = {}) => ({
  firstName: "Testa",
  middleName: "Sample",
  lastName: "Fixture",
  suffix: "",
  dateOfBirth: "1990-04-12",
  sex: "female",
  streetAddress: "Purok 3 Sampaguita Street",
  ...overrides,
});

const outcomeOf = (person, records) => classifyCandidates(person, records);

console.log("\nNormalization");

check("strict names fold case and spacing only", () => {
  assert.strictEqual(strictName("  Maria   CLARA "), "maria clara");
  assert.notStrictEqual(strictName("Peña"), strictName("Pena"));
});

check("loose names drop accents, spaces and punctuation", () => {
  assert.strictEqual(looseName("De la Peña"), looseName("dela pena"));
  assert.strictEqual(looseName("O'Brien-Test"), "obrientest");
});

check("suffix aliases fold together", () => {
  assert.strictEqual(suffixKey("Jr."), suffixKey("junior"));
  assert.strictEqual(suffixKey("3rd"), suffixKey("III"));
  assert.notStrictEqual(suffixKey("Jr."), suffixKey("Sr."));
});

check("barangay keys ignore the Barangay/Brgy prefix", () => {
  assert.strictEqual(barangayKey("Brgy. Testville"), barangayKey("testville"));
  assert.strictEqual(barangayKey("Barangay Testville"), "testville");
});

check("calendar dates keep the typed day and read Date values in UTC", () => {
  assert.strictEqual(calendarDate("1990-04-12"), "1990-04-12");
  assert.strictEqual(calendarDate(new Date("1990-04-12T00:00:00.000Z")), "1990-04-12");
  assert.strictEqual(calendarDate("not a date"), "");
});

check("address tokens expand common abbreviations", () => {
  assert.deepStrictEqual(addressTokens("Prk. 3, Sampaguita St."), ["purok", "3", "sampaguita", "street"]);
});

console.log("\nMatching outcomes");

check("one clean record is a match", () => {
  const result = outcomeOf(applicant(), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.MATCHED);
  assert.deepStrictEqual(result.candidateIds, ["TEST-0001"]);
});

check("case and spacing differences still match", () => {
  const result = outcomeOf(applicant({ firstName: " testa ", lastName: "FIXTURE" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.MATCHED);
});

check("no records is no match", () => {
  assert.strictEqual(outcomeOf(applicant(), []).outcome, MATCH_OUTCOMES.NO_MATCH);
});

check("same name and address but another birth date is never a match", () => {
  const result = outcomeOf(applicant({ dateOfBirth: "1991-04-12" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.PARTIAL_MATCH);
  assert.ok(result.reasons.includes(MATCH_REASONS.DOB_DIFFERS));
});

check("a spelling difference is partial, not a match", () => {
  const result = outcomeOf(applicant({ lastName: "Fíxture" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.PARTIAL_MATCH);
  assert.ok(result.reasons.includes(MATCH_REASONS.NAME_SPELLING_DIFFERS));
});

check("a different first name on the same birthday is unrelated", () => {
  const result = outcomeOf(applicant({ firstName: "Twinny" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.NO_MATCH);
});

check("a missing middle name is partial", () => {
  const result = outcomeOf(applicant({ middleName: "" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.PARTIAL_MATCH);
  assert.deepStrictEqual(result.reasons, [MATCH_REASONS.MIDDLE_NAME_MISSING]);
});

check("a missing street address is partial", () => {
  const result = outcomeOf(applicant({ streetAddress: "" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.PARTIAL_MATCH);
  assert.deepStrictEqual(result.reasons, [MATCH_REASONS.ADDRESS_MISSING]);
});

check("a different sex is a conflict", () => {
  const result = outcomeOf(applicant({ sex: "male" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.CONFLICT);
  assert.ok(result.reasons.includes(MATCH_REASONS.SEX_DIFFERS));
});

check("a different suffix is a conflict", () => {
  const result = outcomeOf(applicant({ suffix: "Jr." }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.CONFLICT);
  assert.ok(result.reasons.includes(MATCH_REASONS.SUFFIX_DIFFERS));
});

check("an equivalent suffix spelling still matches", () => {
  const person = applicant({ suffix: "junior" });
  const result = outcomeOf(person, [record({ suffix: "Jr." })]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.MATCHED);
});

check("a different street is a conflict", () => {
  const result = outcomeOf(applicant({ streetAddress: "Purok 5 Ilang-Ilang Street" }), [record()]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.CONFLICT);
  assert.ok(result.reasons.includes(MATCH_REASONS.ADDRESS_DIFFERS));
});

check("two records that both fit are never picked between", () => {
  const twin = record({ masterResidentId: "TEST-0002" });
  const result = outcomeOf(applicant(), [record(), twin]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.MULTIPLE_MATCHES);
  assert.deepStrictEqual(result.candidateIds, ["TEST-0001", "TEST-0002"]);
});

check("a same-day record that differs only by accents makes the match ambiguous", () => {
  const lookalike = record({ masterResidentId: "TEST-0003", firstName: "Testá" });
  const result = outcomeOf(applicant(), [record(), lookalike]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.MULTIPLE_MATCHES);
});

check("a namesake born on another day does not block a clean match", () => {
  const namesake = record({ masterResidentId: "TEST-0004", dateOfBirth: new Date("1960-01-01") });
  const result = outcomeOf(applicant(), [record(), namesake]);
  assert.strictEqual(result.outcome, MATCH_OUTCOMES.MATCHED);
  assert.deepStrictEqual(result.candidateIds, ["TEST-0001"]);
});

check("candidate lists are capped", () => {
  const many = Array.from({ length: 9 }, (_, index) =>
    record({ masterResidentId: `TEST-10${index}` })
  );
  assert.strictEqual(outcomeOf(applicant(), many).candidateIds.length, 5);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
