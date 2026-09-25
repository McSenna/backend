"use strict";

const { getCompletionForm, getAllCompletionForms } = require("../../config/medicalRecordFields");
const { validateMedicalRecordInput } = require("../../utils/medicalRecordValidation");
const { getQueueRole, getCategoryKeysForRole } = require("../../config/consultationCategories");

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  -> ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function keysOf(categoryKey) {
  const form = getCompletionForm(categoryKey);
  return new Set([...form.common, ...form.service, ...form.followUp].map((f) => f.key));
}

const serviceKeysOf = (categoryKey) =>
  new Set(getCompletionForm(categoryKey).service.map((f) => f.key));

const REQUIRED_COVERAGE = {
  bp_checking: ["systolic", "diastolic", "pulseRate", "symptoms", "recheckDate"],
  immunization: [
    "vaccineName",
    "dose",
    "doseNumber",
    "route",
    "administrationSite",
    "batchNumber",
    "expiryDate",
    "administrationDate",
    "observations",
    "nextDoseDate",
  ],
  prenatal: [
    "gestationalAgeWeeks",
    "gravida",
    "para",
    "weightKg",
    "systolic",
    "diastolic",
    "pulseRate",
    "fundalHeight",
    "fetalHeartRate",
    "fetalMovement",
    "maternalComplaints",
    "nextCheckupDate",
  ],
  general_checkup: [
    "chiefComplaint",
    "symptoms",
    "temperature",
    "systolic",
    "diastolic",
    "pulseRate",
    "respiratoryRate",
    "weightKg",
    "heightCm",
    "medicationAdvice",
  ],
  consultation: [
    "reasonForConsultation",
    "chiefComplaint",
    "historyOfPresentIllness",
    "patientConcern",
    "relevantMedicalHistory",
    "temperature",
    "treatmentAdvice",
  ],
};

const MUST_NOT_APPEAR = {
  bp_checking: ["gestationalAgeWeeks", "vaccineName", "chiefComplaint", "respiratoryRate"],
  immunization: ["systolic", "fundalHeight", "chiefComplaint"],
  prenatal: ["vaccineName", "respiratoryRate", "chiefComplaint"],
  general_checkup: ["vaccineName", "fundalHeight", "gestationalAgeWeeks"],
  consultation: ["vaccineName", "fundalHeight", "heightCm"],
};

section("Every service has its own form");
for (const form of getAllCompletionForms()) {
  check(
    `${form.categoryKey} declares service fields`,
    form.service.length > 0,
    "no service-specific fields"
  );
  check(
    `${form.categoryKey} groups them into sections`,
    form.service.every((f) => typeof f.group === "string" && f.group.length > 0),
    form.service.filter((f) => !f.group).map((f) => f.key).join(", ")
  );
}

section("Each form covers what its service must record");
for (const [categoryKey, expected] of Object.entries(REQUIRED_COVERAGE)) {
  const keys = serviceKeysOf(categoryKey);
  const missing = expected.filter((key) => !keys.has(key));
  check(`${categoryKey} records everything required`, missing.length === 0, `missing: ${missing.join(", ")}`);
}

section("No form collects another service's fields");
for (const [categoryKey, forbidden] of Object.entries(MUST_NOT_APPEAR)) {
  const keys = serviceKeysOf(categoryKey);
  const leaked = forbidden.filter((key) => keys.has(key));
  check(`${categoryKey} stays in its own vocabulary`, leaked.length === 0, `leaked: ${leaked.join(", ")}`);
}

section("Common fields are never duplicated into a service");
for (const form of getAllCompletionForms()) {
  const common = new Set(form.common.map((f) => f.key));
  const duplicated = form.service.filter((f) => common.has(f.key)).map((f) => f.key);
  check(`${form.categoryKey} asks each question once`, duplicated.length === 0, duplicated.join(", "));
}

section("Keys are unique within a form");
for (const form of getAllCompletionForms()) {
  const keys = [...form.common, ...form.service, ...form.followUp].map((f) => f.key);
  const dupes = keys.filter((key, i) => keys.indexOf(key) !== i);
  check(`${form.categoryKey} has no repeated key`, dupes.length === 0, dupes.join(", "));
}

section("Immunization is the one form wired to inventory");
{
  const withInventory = getAllCompletionForms().filter((form) =>
    form.service.some((f) => f.inventoryCategory)
  );
  check("exactly one service links a field to inventory", withInventory.length === 1, `${withInventory.length} found`);
  check(
    "and it is Immunization's vaccine field",
    withInventory[0]?.categoryKey === "immunization" &&
    withInventory[0].service.find((f) => f.inventoryCategory)?.key === "vaccineName"
  );
  const keys = serviceKeysOf("immunization");
  check(
    "which has a lot and expiry to fill",
    keys.has("batchNumber") && keys.has("expiryDate")
  );
}

section("Measurements carry their unit");
{
  const unitless = [];
  for (const form of getAllCompletionForms()) {
    for (const field of form.service) {
      if (field.type !== "number") continue;
      if (["doseNumber", "gravida", "para"].includes(field.key)) continue;
      if (!field.unit) unitless.push(`${form.categoryKey}.${field.key}`);
    }
  }
  check("every measured number states its unit", unitless.length === 0, unitless.join(", "));
}

section("Numbers are bounded, selects are closed");
{
  const unbounded = [];
  const optionless = [];
  for (const form of getAllCompletionForms()) {
    for (const field of form.service) {
      if (field.type === "number" && (typeof field.min !== "number" || typeof field.max !== "number")) {
        unbounded.push(`${form.categoryKey}.${field.key}`);
      }
      if (field.type === "select" && !(field.options || []).length) {
        optionless.push(`${form.categoryKey}.${field.key}`);
      }
    }
  }
  check("every number has a range", unbounded.length === 0, unbounded.join(", "));
  check("every select has choices", optionless.length === 0, optionless.join(", "));
}

section("The validator enforces what the form declares");
{
  for (const form of getAllCompletionForms()) {
    const requiredKeys = form.service.filter((f) => f.required).map((f) => f.key);
    if (!requiredKeys.length) continue;

    const result = validateMedicalRecordInput(form.categoryKey, { assessment: "Seen." });
    const named = requiredKeys.filter((key) => {
      const label = form.service.find((f) => f.key === key).label;
      return result.errors.some((e) => e.startsWith(label));
    });
    check(
      `${form.categoryKey} refuses a record missing ${requiredKeys.join(", ")}`,
      !result.ok && named.length === requiredKeys.length,
      result.errors.join(" ")
    );
  }

  const noAssessment = validateMedicalRecordInput("bp_checking", {
    serviceDetails: { systolic: 120, diastolic: 80 },
  });
  check("a record with no assessment is refused", !noAssessment.ok);
}

section("Values are stored typed, not as the strings they arrived as");
{
  const result = validateMedicalRecordInput("prenatal", {
    assessment: "Well.",
    serviceDetails: {
      systolic: "110",
      diastolic: "70",
      fetalMovement: "active",
      nextCheckupDate: "2026-10-01",
    },
  });
  check("accepted", result.ok, result.errors.join(" "));
  check("numbers become numbers", result.value.serviceDetails.systolic === 110);
  check("dates become dates", result.value.serviceDetails.nextCheckupDate instanceof Date);
  check("selects keep their stored value", result.value.serviceDetails.fetalMovement === "active");
}

section("Out-of-range and off-list values are refused, never clamped");
{
  const high = validateMedicalRecordInput("bp_checking", {
    assessment: "x",
    serviceDetails: { systolic: 1200, diastolic: 80 },
  });
  check("an impossible systolic is rejected", !high.ok);
  check("and is not silently stored at the ceiling", high.value.serviceDetails.systolic === undefined);

  const offList = validateMedicalRecordInput("immunization", {
    assessment: "x",
    serviceDetails: { vaccineName: "Measles", doseNumber: 1, route: "telepathy" },
  });
  check("a route outside the catalogue is rejected", !offList.ok);
}

section("Unknown keys are dropped, not rejected");
{
  const result = validateMedicalRecordInput("bp_checking", {
    assessment: "Seen.",
    serviceDetails: { systolic: 120, diastolic: 80, somethingNew: "from a newer client" },
  });
  check("the record is still accepted", result.ok, result.errors.join(" "));
  check("and the unknown key is not stored", result.value.serviceDetails.somethingNew === undefined);
}

section("Who may complete what, straight from the service catalogue");
{
  const expected = {
    bhw: ["bp_checking"],
    midwife: ["immunization", "prenatal"],
    doctor: ["general_checkup", "consultation"],
  };

  for (const [role, services] of Object.entries(expected)) {
    const owned = getCategoryKeysForRole(role).sort();
    check(`${role} owns exactly ${services.join(", ")}`, owned.join() === [...services].sort().join());
    for (const service of services) {
      check(`  ${service} routes to the ${role}`, getQueueRole(service) === role);
    }
  }

  check("admin oversees every service", getCategoryKeysForRole("admin").length === 5);
  check("an unknown role owns nothing", getCategoryKeysForRole("janitor").length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
