"use strict";

process.env.TZ = "Asia/Manila";

const { isQueuedService } = require("../../config/consultationCategories");
const { planSlotFor } = require("../../services/triage/missionQueueContext");
const { parseQueuedRequest } = require("../../services/doctorQueue/request");

let passed = 0;
let failed = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// A fictional mission far enough ahead that every start is in the future.
const DAY = "2030-06-04";
const at = (time) => new Date(`${DAY}T${time}:00+08:00`);
const clock = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : null);
const mission = {
  _id: "m1",
  date: new Date(2030, 5, 4),
  morningStart: "08:00",
  morningEnd: "12:00",
  afternoonStart: "13:00",
  afternoonEnd: "15:00",
};
const durations = new Map([["general_checkup", 15], ["consultation", 30]]);
const visit = (start, minutes) => ({ _id: `${start}-${minutes}`, slotStart: at(start), slotEnd: new Date(at(start).getTime() + minutes * 60000) });
const plan = (consultationType, booked, map = durations) =>
  planSlotFor({ appointment: { consultationType }, mission, missionCategoryMap: map, bookedSim: booked });

console.log("\nDoctor services are queued, prenatal and BP are not");
check("general checkup and consultation are queued", isQueuedService("general_checkup") && isQueuedService("consultation"));
check("prenatal, BP and immunization are not", ["prenatal", "bp_checking", "immunization"].every((key) => !isQueuedService(key)));

console.log("\nThe request carries what, never when");
const parsed = parseQueuedRequest("general_checkup", {
  description: "  Cough  ",
  missionScheduleId: "64b000000000000000000001",
  slotStart: "2030-06-04T00:00:00.000Z",
  appointmentDate: "2030-06-04",
});
check("a client-supplied mission and time are dropped", !("slotStart" in parsed) && !("missionScheduleId" in parsed) && parsed.description === "Cough");
let missing = null;
try { parseQueuedRequest("consultation", { description: "  " }); } catch (error) { missing = error; }
check("a request without a reason is refused", missing?.statusCode === 400);

console.log("\nEach service uses its own mission length");
check("a checkup takes 15 minutes from 08:00", plan("general_checkup", [])?.durationMinutes === 15 && clock(plan("general_checkup", []).slotStartIso) === "08:00");
check("a consultation takes 30 minutes", plan("consultation", [])?.durationMinutes === 30);
const after = plan("consultation", [visit("08:00", 15)]);
check("the next visit starts when the last one ends, on the 5-minute grid", clock(after?.slotStartIso) === "08:15", clock(after?.slotStartIso));
check(
  "a long visit never overlaps the next booking",
  clock(plan("consultation", [visit("08:00", 15), visit("08:30", 15)])?.slotStartIso) === "08:45"
);

console.log("\nWindows, breaks and closing time");
const morningAlmostFull = [visit("08:00", 210)];
check("a 30-minute visit fits 11:30 to 12:00, ending exactly at the break", clock(plan("consultation", morningAlmostFull)?.slotStartIso) === "11:30");
const morningFull = [visit("08:00", 225)];
check("a visit never spans the lunch break: it moves to 13:00", clock(plan("consultation", morningFull)?.slotStartIso) === "13:00");
const dayAlmostFull = [visit("08:00", 240), visit("13:00", 105)];
check("15 minutes left at closing: no consultation is placed", plan("consultation", dayAlmostFull) === null);
check("a 15-minute checkup fills the last gap and ends exactly at closing", clock(plan("general_checkup", dayAlmostFull)?.slotStartIso) === "14:45");
check("a full day places nothing", plan("general_checkup", [visit("08:00", 240), visit("13:00", 120)]) === null);

console.log("\nOnly what the mission offers, with a valid length");
check("a mission without the service places nothing", plan("consultation", [], new Map([["general_checkup", 15]])) === null);
check(
  "a stored length outside the range is held to it, as mission saves do (consultation 20 to 30)",
  plan("consultation", [], new Map([["consultation", 45]]))?.durationMinutes === 30
);
check("a mission service with no length places nothing, never a guessed one", plan("consultation", [], new Map([["consultation", undefined]])) === null);
check("weekly services are never placed on a mission", plan("prenatal", [], new Map([["prenatal", 20]])) === null);

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
