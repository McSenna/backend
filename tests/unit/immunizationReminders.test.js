"use strict";
const assert = require("node:assert/strict");
const { planReminderVisits } = require("../../services/immunization/reminderPlanner");
const dose = (key, scheduledOn, status = "Upcoming", reviewRequired = false) => ({ key, vaccineKey: key, label: key, scheduledOn, status, reviewRequired });
assert.deepEqual(planReminderVisits([dose("a", "2026-10-30"), dose("b", "2026-10-30")], "2026-10-23"), [
  { visitKey: "2026-10-30", scheduledOn: "2026-10-30", stage: "7", doseKeys: ["a", "b"] },
]);
assert.equal(planReminderVisits([dose("a", "2026-10-28")], "2026-10-23").length, 0, "no catchup for past lead-time stages");
assert.deepEqual(planReminderVisits([dose("a", "2026-10-24"), dose("b", "2026-10-23")], "2026-10-23").map(v => v.stage), ["0", "1"]);
assert.equal(planReminderVisits([dose("a", "2026-10-23", "Administered"), dose("b", "2026-10-23", "Requires review", true)], "2026-10-23").length, 0);
const initialBacklog = planReminderVisits([dose("a", "2026-08-01", "Overdue"), dose("b", "2026-09-01", "Overdue")], "2026-10-23");
assert.equal(initialBacklog.length,1,"late linkage groups old missed doses into one notice");
assert.equal(initialBacklog[0].scheduledOn,"2026-08-01");
assert.deepEqual(initialBacklog[0].doseKeys,["a","b"]);
assert.notEqual(planReminderVisits([dose("a","2026-08-01","Overdue")],"2026-10-23")[0].visitKey,planReminderVisits([dose("b","2026-08-01","Overdue")],"2026-10-23")[0].visitKey,"newly missed doses have distinct durable keys");

const delivered = [{visitKey:"overdue-previous",doseKeys:["a"],scheduledOn:"2026-08-01",stage:"overdue"}];
const later = planReminderVisits([dose("a","2026-08-01","Overdue"),dose("b","2026-09-01","Overdue")],"2026-10-23",[7,1,0],7,delivered);
assert.equal(later.length,2,"a new missed visit receives its own overdue stage while an older one remains incomplete");
assert.ok(later.some(v=>v.visitKey === "overdue-previous" && v.doseKeys.join() === "a"));
assert.ok(later.some(v=>v.visitKey !== "overdue-previous" && v.doseKeys.join() === "b"));

console.log("Immunization reminder planner passed");
const movedVisit = planReminderVisits([dose('a','2026-10-01','Overdue')],'2026-10-23',[7,1,0],7,delivered);
assert.notEqual(movedVisit[0].visitKey,'overdue-previous','missing an explicitly rescheduled follow-up produces a new overdue reminder');
