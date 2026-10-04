"use strict";

// Date limits on medical record fields: a dose given cannot be in the future,
// and follow-up style dates cannot fall before the visit they follow.

const { validateMedicalRecordInput } = require("../../utils/medicalRecordValidation");

let passed = 0;
let failed = 0;
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

const bp = (recheckDate) => ({ assessment: "Seen", serviceDetails: { systolic: 120, diastolic: 80, recheckDate } });

const early = validateMedicalRecordInput("bp_checking", bp("2024-03-01"), { visitDay: "2024-03-15" });
check("a recheck before the visit is refused", early.errors.includes("Recheck date cannot be before the visit date."), early.errors.join(" | "));

const later = validateMedicalRecordInput("bp_checking", bp("2024-04-01"), { visitDay: "2024-03-15" });
check("a recheck after an old visit is accepted, even though it is in the past", later.ok, later.errors.join(" | "));

const sameDay = validateMedicalRecordInput("bp_checking", bp("2024-03-15"), { visitDay: "2024-03-15" });
check("a recheck on the visit day is accepted", sameDay.ok, sameDay.errors.join(" | "));

const noContext = validateMedicalRecordInput("bp_checking", bp("2001-01-01"));
check("without a visit day the after-visit rule is not applied", noContext.ok, noContext.errors.join(" | "));

const futureDose = validateMedicalRecordInput("immunization", { assessment: "Given", serviceDetails: { administrationDate: "2999-01-01" } });
check("a dose given in the future is refused", futureDose.errors.includes("Date administered cannot be in the future."), futureDose.errors.join(" | "));

const followUp = validateMedicalRecordInput(
  "bp_checking",
  { ...bp(""), followUpRequired: true, followUpDate: "2024-01-01" },
  { visitDay: "2024-03-15" }
);
check("a follow-up before the visit is refused", followUp.errors.includes("Follow-up date cannot be before the visit date."), followUp.errors.join(" | "));

const unusedFollowUp = validateMedicalRecordInput(
  "bp_checking",
  { ...bp(""), followUpRequired: false, followUpDate: "2024-01-01" },
  { visitDay: "2024-03-15" }
);
check("a follow-up date is ignored when no follow-up is needed", unusedFollowUp.ok, unusedFollowUp.errors.join(" | "));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
