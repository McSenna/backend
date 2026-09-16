"use strict";

const {
  SERVICE_QUEUE_MAPPING,
  canCreateMission,
  getQueueRole,
  getCategoryKeysForRole,
  getEligibleProviderRoles,
  isProviderRoleAllowed,
} = require("../config/consultationCategories");
const { resolveQueueScope, applyCategoryFilter } = require("../controllers/appointmentController");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sameSet(a, b) {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

function scopeFor(role, query = {}) {
  return resolveQueueScope({ user: { role }, query });
}

console.log("\nService → queue role");
check("Consultation routes to the doctor", getQueueRole("consultation") === "doctor");
check("General Checkup routes to the doctor", getQueueRole("general_checkup") === "doctor");
check("Prenatal routes to the midwife", getQueueRole("prenatal") === "midwife");
check("Immunization routes to the midwife", getQueueRole("immunization") === "midwife");
check("BP Checking routes to the BHW", getQueueRole("bp_checking") === "bhw");
check(
  "the flattened map agrees with the per-service lookup",
  Object.entries(SERVICE_QUEUE_MAPPING).every(([key, role]) => getQueueRole(key) === role)
);

console.log("\nQueue contents by role");
check(
  "the doctor queue holds Consultation and General Checkup only",
  sameSet(getCategoryKeysForRole("doctor"), ["consultation", "general_checkup"]),
  getCategoryKeysForRole("doctor").join(",")
);
check(
  "the midwife queue holds Prenatal and Immunization only",
  sameSet(getCategoryKeysForRole("midwife"), ["prenatal", "immunization"]),
  getCategoryKeysForRole("midwife").join(",")
);
check(
  "the BHW queue holds BP Checking only",
  sameSet(getCategoryKeysForRole("bhw"), ["bp_checking"]),
  getCategoryKeysForRole("bhw").join(",")
);
check("admin oversees all five services", getCategoryKeysForRole("admin").length === 5);
check("an unknown role is granted no queue", getCategoryKeysForRole("resident").length === 0);

console.log("\nQueues do not overlap");
const doctorKeys = getCategoryKeysForRole("doctor");
const midwifeKeys = getCategoryKeysForRole("midwife");
const bhwKeys = getCategoryKeysForRole("bhw");
check("the doctor never sees Prenatal", !doctorKeys.includes("prenatal"));
check("the doctor never sees Immunization", !doctorKeys.includes("immunization"));
check("the doctor never sees BP Checking", !doctorKeys.includes("bp_checking"));
check("the midwife never sees Consultation", !midwifeKeys.includes("consultation"));
check("the midwife never sees General Checkup", !midwifeKeys.includes("general_checkup"));
check("the midwife never sees BP Checking", !midwifeKeys.includes("bp_checking"));
check("the BHW sees nothing but BP Checking", sameSet(bhwKeys, ["bp_checking"]));

console.log("\nProvider eligibility follows the same rule");
check("Prenatal offers the midwife", isProviderRoleAllowed("prenatal", "midwife"));
check("Prenatal does not offer the doctor", !isProviderRoleAllowed("prenatal", "doctor"));
check("BP Checking offers the BHW", isProviderRoleAllowed("bp_checking", "bhw"));
check("BP Checking does not offer the doctor", !isProviderRoleAllowed("bp_checking", "doctor"));
check("Consultation does not offer the BHW", !isProviderRoleAllowed("consultation", "bhw"));
check("an unknown service offers nobody", getEligibleProviderRoles("nonsense").length === 0);
check(
  "the eligible provider is always the owning role",
  Object.keys(SERVICE_QUEUE_MAPPING).every((key) =>
    sameSet(getEligibleProviderRoles(key), [getQueueRole(key)])
  )
);

console.log("\nRequest scoping — a role cannot widen its own queue");
check(
  "a signed-in doctor is scoped to the doctor queue",
  sameSet(scopeFor("doctor").categoryKeys, doctorKeys)
);
check(
  "a doctor asking for the BHW queue still gets their own",
  sameSet(scopeFor("doctor", { role: "bhw" }).categoryKeys, doctorKeys),
  scopeFor("doctor", { role: "bhw" }).categoryKeys.join(",")
);
check(
  "a midwife asking for the doctor queue still gets their own",
  sameSet(scopeFor("midwife", { role: "doctor" }).categoryKeys, midwifeKeys)
);
check(
  "a BHW asking for every queue still gets their own",
  sameSet(scopeFor("bhw", { role: "admin" }).categoryKeys, bhwKeys)
);
check(
  "admin with no filter is unrestricted, not pinned to today's services",
  scopeFor("admin").categoryKeys === null
);
check(
  "admin filtered to the midwife sees the midwife queue",
  sameSet(scopeFor("admin", { role: "midwife" }).categoryKeys, midwifeKeys)
);
check(
  "admin given a nonsense role falls back to unrestricted",
  scopeFor("admin", { role: "wizard" }).categoryKeys === null
);
check(
  "a retired service still reaches admin",
  applyCategoryFilter(scopeFor("admin").categoryKeys, "blood_pressure_monitoring").length === 1
);
check(
  "but a retired service reaches no ordinary queue",
  applyCategoryFilter(scopeFor("doctor").categoryKeys, "blood_pressure_monitoring").length === 0
);

console.log("\nMission creation is the doctor's, not every clinician's");
check("a doctor may open a mission", canCreateMission("doctor"));
check("an admin may open a mission", canCreateMission("admin"));
check("a midwife may not open a mission", !canCreateMission("midwife"));
check("a BHW may not open a mission", !canCreateMission("bhw"));
check("a resident may not open a mission", !canCreateMission("resident"));
check("role matching ignores case and padding", canCreateMission("  Doctor "));

console.log("\nService filter cannot escape the role scope");
check(
  "a doctor filtering to Consultation gets Consultation",
  sameSet(applyCategoryFilter(doctorKeys, "consultation"), ["consultation"])
);
check(
  "a doctor filtering to Prenatal gets nothing, not the midwife's queue",
  applyCategoryFilter(doctorKeys, "prenatal").length === 0
);
check(
  "a BHW filtering to Consultation gets nothing",
  applyCategoryFilter(bhwKeys, "consultation").length === 0
);
check("no filter leaves the scope untouched", sameSet(applyCategoryFilter(doctorKeys, ""), doctorKeys));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
