"use strict";
const assert = require("node:assert/strict");
const {
  nextThursday,
  plannedVisits,
  withAssignedVisits,
} = require("../../services/immunization/appointmentPlan");
assert.equal(
  nextThursday("2026-10-11"),
  "2026-10-15",
  "Sunday target uses the following Thursday",
);
assert.equal(
  nextThursday("2026-10-15"),
  "2026-10-15",
  "Thursday is never moved earlier or a week later",
);
assert.equal(nextThursday("2026-12-31"), "2026-12-31");
assert.equal(nextThursday("2027-01-01"), "2027-01-07");
assert.throws(() => nextThursday("2026-02-30"));
const dose = (key, date, extra = {}) => ({
  key,
  scheduledOn: date,
  targetOn: date,
  status: "Upcoming",
  record: null,
  ...extra,
});
const visits = plannedVisits([
  dose("a", "2026-10-11"),
  dose("b", "2026-10-11"),
  dose("c", "2026-10-11", { status: "Administered" }),
]);
assert.deepEqual(visits, [
  { targetOn: "2026-10-11", thursday: "2026-10-15", doseKeys: ["a", "b"] },
]);
assert.equal(
  plannedVisits([dose("a", "2026-10-11", { record: { state: "void" } })])
    .length,
  0,
  "void records need a documented follow-up",
);
const appointment = {
  _id: "visit-a",
  immunizationTargetOn: "2026-10-11",
  immunizationDoseKeys: ["a"],
  slotStart: new Date("2026-10-15T00:00:00Z"),
  status: "confirmed",
};
const result = withAssignedVisits(
  [dose("a", "2026-10-11")],
  [appointment],
  "2026-10-12",
  7,
);
assert.equal(result[0].scheduledOn, "2026-10-15");
assert.equal(
  result[0].targetOn,
  "2026-10-11",
  "routine clinical target remains separate",
);
assert.equal(result[0].appointmentId, "visit-a");
assert.equal(
  result[0].status,
  "Upcoming",
  "reminder status follows the reserved Thursday",
);
const changed = withAssignedVisits(
  [
    dose("a", "2026-10-11", {
      record: { state: "deferred", followUpOn: "2026-10-18" },
    }),
  ],
  [appointment],
  "2026-10-08",
  7,
);
assert.equal(
  changed[0].appointmentId,
  undefined,
  "a fresh follow-up must never inherit a stale old appointment while workers overlap",
);
assert.equal(changed[0].proposedThursday, "2026-10-22");
const voided = withAssignedVisits(
  [
    dose("a", "2026-10-11", {
      record: { state: "void" },
      status: "Requires review",
    }),
  ],
  [appointment],
  "2026-10-08",
  7,
);
assert.equal(
  voided[0].appointmentId,
  undefined,
  "voiding a dose invalidates its old appointment projection immediately",
);
console.log("Automatic Thursday planning assertions passed");
