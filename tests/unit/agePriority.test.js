"use strict";

process.env.TZ = "Asia/Manila";

const {
  PRIORITY_GROUPS,
  UNKNOWN_PRIORITY_GROUP,
  computeAgeYears,
  ageToTier,
  priorityOf,
  priorityGroupLabel,
} = require("../../utils/priorityQueue");
const { byPriorityThenCreated } = require("../../services/triage/triagePriority");

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

// Manila wall-clock instants; every birth date here is invented.
const at = (day, time = "12:00") => new Date(`${day}T${time}:00+08:00`);
const groupOn = (dob, day, time) => priorityOf(dob, at(day, time)).group;

console.log("\nThe six groups, in the required order");
check(
  "groups are numbered 1 to 6 in the brief's order",
  PRIORITY_GROUPS.map((g) => `${g.group}:${g.key}`).join(",") ===
    "1:infant,2:senior,3:young_child,4:child,5:adolescent,6:adult"
);
const ages = { infant: 0, senior: 75, young_child: 3, child: 9, adolescent: 15, adult: 34 };
check(
  "each age lands in its group",
  Object.entries(ages).every(([key, age]) => ageToTier(age) === PRIORITY_GROUPS.find((g) => g.key === key).group)
);
check("the groups leave no gap from 0 to 120", Array.from({ length: 121 }, (_, age) => ageToTier(age)).every((g) => g >= 1 && g <= 6));

console.log("\nBirthday boundaries turn over on the birthday itself");
const DOB = "2020-06-15";
const boundary = (years, expectBefore, expectOn) => {
  const birthday = `${2020 + years}-06-15`;
  const dayBefore = `${2020 + years}-06-14`;
  check(
    `birthday ${years}: group ${expectBefore} the day before, ${expectOn} on the day`,
    groupOn(DOB, dayBefore, "23:59") === expectBefore && groupOn(DOB, birthday, "00:00") === expectOn,
    `${groupOn(DOB, dayBefore, "23:59")} then ${groupOn(DOB, birthday, "00:00")}`
  );
};
boundary(1, 1, 3);
boundary(6, 3, 4);
boundary(13, 4, 5);
boundary(18, 5, 6);
boundary(60, 6, 2);
check("born today is an infant", groupOn(DOB, DOB, "08:00") === 1);
check("11 months and 30 days is still an infant", groupOn("2025-11-08", "2026-11-07") === 1);

console.log("\nCalendar months, not 365-day years");
check("a 1-year-old is 1 across a leap year", computeAgeYears(at("2023-03-01"), at("2024-03-01")) === 1);
check("one day short of the birthday after a leap day is still 0", computeAgeYears(at("2023-03-02"), at("2024-03-01")) === 0);
check("the age uses the Manila date, not UTC", computeAgeYears(at("2020-06-15", "00:30"), at("2026-06-15", "00:10")) === 6);

console.log("\nLeap-day birthdays: 1 March in common years");
const LEAP = "2024-02-29";
check("on 28 Feb 2025 a leap-day baby is still under 1", groupOn(LEAP, "2025-02-28") === 1);
check("on 1 Mar 2025 a leap-day baby turns 1", groupOn(LEAP, "2025-03-01") === 3);
check("on 29 Feb 2028 the birthday falls on the day", computeAgeYears(at(LEAP), at("2028-02-29")) === 4);
check(
  "born 29 Feb 2020: still group 3 on 28 Feb 2026, group 4 (age 6) on 1 Mar 2026",
  groupOn(LEAP.replace("2024", "2020"), "2026-02-28") === 3 && groupOn(LEAP.replace("2024", "2020"), "2026-03-01") === 4
);
check(
  "born 29 Feb 1964 turns 60 on 29 Feb 2024 and not before",
  computeAgeYears(at("1964-02-29"), at("2024-02-28")) === 59 && computeAgeYears(at("1964-02-29"), at("2024-02-29")) === 60
);

console.log("\nMissing, invalid and future birth dates are flagged, not guessed");
for (const [label, dob] of [["missing", null], ["empty", ""], ["unreadable", "not a date"], ["future", "2030-01-01"]]) {
  const result = priorityOf(dob, at("2026-11-07"));
  check(`${label} birth date: no age, the explicit unknown group`, result.ageYears === null && result.group === UNKNOWN_PRIORITY_GROUP);
}
check("the unknown group is labeled for staff", priorityGroupLabel(UNKNOWN_PRIORITY_GROUP) === "Birth date needed");
check("an unknown group sorts after all six age groups", PRIORITY_GROUPS.every((g) => g.group < UNKNOWN_PRIORITY_GROUP));

console.log("\nQueue order: group, then submission time, then a stable id");
const row = (id, group, createdAt) => ({ _id: id, prioritySortKey: group, createdAt });
const queue = [
  row("a6", 6, "2026-11-01T00:00:00Z"),
  row("u7", 7, "2026-10-01T00:00:00Z"),
  row("b2", 2, "2026-11-03T00:00:00Z"),
  row("c1", 1, "2026-11-05T00:00:00Z"),
  row("d5", 5, "2026-11-01T00:00:00Z"),
  row("e3", 3, "2026-11-02T00:00:00Z"),
  row("f4", 4, "2026-11-02T00:00:00Z"),
  row("g2", 2, "2026-11-02T00:00:00Z"),
];
const ranked = [...queue].sort(byPriorityThenCreated).map((r) => r._id).join(",");
check("all six groups follow the exact order, unknown last", ranked === "c1,g2,b2,e3,f4,d5,a6,u7", ranked);
const ties = [row("z", 6, "2026-11-01T00:00:00Z"), row("m", 6, "2026-11-01T00:00:00Z"), row("a", 6, "2026-11-01T00:00:00Z")];
const once = [...ties].sort(byPriorityThenCreated).map((r) => r._id).join("");
const again = [...ties].reverse().sort(byPriorityThenCreated).map((r) => r._id).join("");
check("identical submission times break by id, the same way every run", once === "amz" && again === "amz", `${once} ${again}`);
const legacy = [row("old", undefined, "2026-01-01T00:00:00Z"), row("new", 6, "2026-11-01T00:00:00Z")];
check(
  "a row with no stored group ranks as unknown, never ahead of an age group",
  [...legacy].sort(byPriorityThenCreated)[0]._id === "new"
);

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
