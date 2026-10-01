"use strict";

process.env.TZ = "Asia/Manila";

const { takesFirstOpenSlot } = require("../../services/appointment/reschedulePriority");
const { byPriorityThenCreated } = require("../../services/triage/triagePriority");

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

console.log("\nWhich services take the first open slot");
check("immunization does", takesFirstOpenSlot("immunization"));
for (const key of ["bp_checking", "prenatal", "general_checkup", "consultation", "unknown"]) {
  check(`${key} does not`, !takesFirstOpenSlot(key));
}

console.log("\nPending order: rescheduled first, then age tier, then request time");
const row = (name, extra) => ({ name, prioritySortKey: 4, createdAt: "2026-09-20T00:00:00Z", ...extra });
const pending = [
  row("infant, normal", { prioritySortKey: 0, createdAt: "2026-09-01T00:00:00Z" }),
  row("adult, rescheduled second", { reschedulePriorityAt: "2026-09-30T09:05:00+08:00" }),
  row("adult, normal, older request", { createdAt: "2026-09-02T00:00:00Z" }),
  row("adult, rescheduled first", { reschedulePriorityAt: "2026-09-30T09:00:00+08:00" }),
  row("adult, normal, newer request", { createdAt: "2026-09-03T00:00:00Z" }),
];
const order = [...pending].sort(byPriorityThenCreated).map((r) => r.name);
check(
  "rescheduled requests lead, earliest reschedule first, then the existing order",
  order.join(" | ") ===
    [
      "adult, rescheduled first",
      "adult, rescheduled second",
      "infant, normal",
      "adult, normal, older request",
      "adult, normal, newer request",
    ].join(" | "),
  order.join(" | ")
);
check(
  "the order is stable across input permutations",
  [...pending].reverse().sort(byPriorityThenCreated).map((r) => r.name).join() === order.join()
);

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
