"use strict";

// Match server.js: every day boundary below is a Manila calendar day.
process.env.TZ = "Asia/Manila";

const {
  isServiceDay,
  assertServiceDay,
  assertCategoriesFitDay,
  assertCompletionDayReached,
} = require("../../services/appointment/serviceDayRules");
const { planSlotFor } = require("../../services/triage/missionQueueContext");
const { normalizeDateInput } = require("../../services/mission/missionPayload");

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

function thrown(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

// Oct 5–11 2026 runs Monday to Sunday; Oct 8 is the Thursday.
const WEEK = [
  ["Monday", "2026-10-05"],
  ["Tuesday", "2026-10-06"],
  ["Wednesday", "2026-10-07"],
  ["Thursday", "2026-10-08"],
  ["Friday", "2026-10-09"],
  ["Saturday", "2026-10-10"],
  ["Sunday", "2026-10-11"],
];
const at = (dateKey, time = "09:00") => new Date(`${dateKey}T${time}:00+08:00`);

console.log("\nImmunization runs on Thursdays only");
for (const [name, key] of WEEK) {
  const expected = name === "Thursday";
  check(`${name} is ${expected ? "allowed" : "rejected"}`, isServiceDay("immunization", at(key)) === expected);
}

console.log("\nOther services keep every day");
for (const key of ["bp_checking", "prenatal", "general_checkup", "consultation"]) {
  check(`${key} is allowed on a Tuesday`, isServiceDay(key, at("2026-10-06")));
}

console.log("\nDay boundaries do not drift through UTC");
check("a mission saved as Manila midnight (Wed 16:00 UTC) reads as Thursday", isServiceDay("immunization", "2026-10-07T16:00:00.000Z"));
check("Thursday 23:59 Manila is still Thursday", isServiceDay("immunization", "2026-10-08T15:59:00.000Z"));
check("Friday 00:00 Manila is no longer Thursday", !isServiceDay("immunization", "2026-10-08T16:00:00.000Z"));
check("a date-only mission input normalizes to that Thursday", isServiceDay("immunization", normalizeDateInput("2026-10-08")));
check("an invalid date is never a service day", !isServiceDay("immunization", "not-a-date"));

console.log("\nRejection messages");
const dayError = thrown(() => assertServiceDay("immunization", at("2026-10-07")));
check(
  "a Wednesday immunization, the old day, is a 400 with the resident-facing message",
  dayError?.statusCode === 400 &&
    dayError.message === "Immunization appointments are only available on Thursdays.",
  dayError?.message
);
check("a Thursday immunization passes", thrown(() => assertServiceDay("immunization", at("2026-10-08"))) === null);

const missionError = thrown(() =>
  assertCategoriesFitDay([{ categoryKey: "prenatal" }, { categoryKey: "immunization" }], at("2026-10-06", "00:00"))
);
check(
  "a Tuesday mission offering immunization is rejected with a staff-facing fix",
  missionError?.statusCode === 400 && missionError.message.includes("turn off Immunization"),
  missionError?.message
);
check(
  "a Tuesday mission without immunization passes",
  thrown(() => assertCategoriesFitDay([{ categoryKey: "prenatal" }, { categoryKey: "bp_checking" }], at("2026-10-06", "00:00"))) === null
);

console.log("\nComplete opens on the scheduled calendar day");
const immunization = { consultationType: "immunization", slotStart: at("2026-10-08", "09:00") };
const before = thrown(() => assertCompletionDayReached(immunization, at("2026-10-07", "23:59")));
check("the day before is rejected with 409", before?.statusCode === 409, before?.message);
check("the rejection names the scheduled day", Boolean(before?.message.includes("Thu, Oct 8")), before?.message);
check(
  "the scheduled Thursday opens at midnight, before the slot time",
  thrown(() => assertCompletionDayReached(immunization, at("2026-10-08", "00:00"))) === null
);
check("later the same day is allowed", thrown(() => assertCompletionDayReached(immunization, at("2026-10-08", "16:30"))) === null);
check("a later day keeps the existing behaviour (allowed)", thrown(() => assertCompletionDayReached(immunization, at("2026-10-09"))) === null);
check(
  "an immunization without a slot cannot be completed",
  thrown(() => assertCompletionDayReached({ consultationType: "immunization", slotStart: null }, at("2026-10-08")))?.statusCode === 409
);
for (const key of ["bp_checking", "prenatal", "general_checkup", "consultation"]) {
  check(
    `${key} completion is unchanged ahead of its slot`,
    thrown(() => assertCompletionDayReached({ consultationType: key, slotStart: at("2026-10-09") }, at("2026-10-05"))) === null
  );
}

console.log("\nTriage never auto-books immunization onto the wrong day");
const missionOn = (dateKey) => ({
  _id: "m1",
  date: at(dateKey, "00:00"),
  morningStart: "08:00",
  morningEnd: "12:00",
  afternoonStart: "13:00",
  afternoonEnd: "17:00",
});
const categoryMap = new Map([["immunization", 10], ["prenatal", 20]]);
const plan = (type, dateKey) =>
  planSlotFor({ appointment: { consultationType: type }, mission: missionOn(dateKey), missionCategoryMap: categoryMap, bookedSim: [] });
// Triage only plans future slots, so these missions sit in the week after next.
const upcoming = (weekday) => {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + 7 + ((weekday - day.getDay() + 7) % 7 || 7));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

check("a Tuesday mission that still lists immunization gets no plan", plan("immunization", upcoming(2)) === null);
// Immunization has its own weekly schedule now, so no mission ever places it.
check("even a Thursday mission that lists immunization gets no plan", plan("immunization", upcoming(4)) === null);
check("prenatal still plans on a Tuesday", plan("prenatal", upcoming(2))?.durationMinutes === 20);
check("prenatal still plans on a Thursday mission", plan("prenatal", upcoming(4))?.durationMinutes === 20);
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
check(
  "a mission day that has passed gets no plan",
  plan("prenatal", `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`) === null
);

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
