"use strict";

process.env.TZ = "Asia/Manila";

const { getQueueRole, isWeeklyService, residentPicksTime } = require("../../config/consultationCategories");
const { dayStartOf, positionStarts } = require("../../services/immunization/weeklyCalendar");
const { DAY_STATUS, describeDay, scheduleSummary } = require("../../services/regularSchedule/calendar");
const { parseRegularStart } = require("../../services/regularSchedule/request");
const { assertMissionService } = require("../../services/appointment/missionServiceRules");
const { visitsOnClosedDays } = require("../../services/regularSchedule/closedDayAudit");

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
const thrown = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
};

const PRENATAL = "prenatal";
const THURSDAY_MESSAGE =
  "Prenatal appointments are unavailable on Thursdays because the midwife is assigned to immunization services. Please choose another available day.";
const at = (day, time) => new Date(`${day}T${time}:00+08:00`);
// Fixed fictional week: Mon 2026-11-09 to Sun 2026-11-15.
const WED = "2026-11-11";
const THU = "2026-11-12";
const SAT = "2026-11-14";
const NOW = at("2026-11-06", "15:00");
const pick = (categoryKey, appointmentDate, slotStart) =>
  thrown(() => parseRegularStart(categoryKey, { appointmentDate, slotStart }, NOW));

console.log("\nPrenatal is the midwife's, on its own resident-picked schedule");
check("prenatal is assigned to the midwife", getQueueRole(PRENATAL) === "midwife");
check("the resident picks prenatal's date and time", isWeeklyService(PRENATAL) && residentPicksTime(PRENATAL));
check("a mission may not list prenatal", /own schedule/.test(thrown(() => assertMissionService(PRENATAL))?.message ?? ""));

console.log("\nThursday is closed, with the reason");
const thursday = describeDay({ categoryKey: PRENATAL, dayStart: dayStartOf(THU), booked: [], now: NOW });
check("Thursday shows as closed with no slots", thursday.status === DAY_STATUS.CLOSED && thursday.openSlots === 0 && thursday.totalSlots === 0);
const thursdayPick = pick(PRENATAL, THU, at(THU, "09:00").toISOString());
check(
  "a Thursday booking is refused with the midwife message",
  thursdayPick?.statusCode === 400 && thursdayPick.message === THURSDAY_MESSAGE,
  thursdayPick?.message
);
const summary = scheduleSummary(PRENATAL, NOW);
check(
  "the schedule tells the app why Thursday is closed",
  summary.closedDays.length === 1 && summary.closedDays[0].weekday === 4 && summary.closedDays[0].reason === THURSDAY_MESSAGE
);
check("the schedule lists no Thursday hours", !summary.weekdays.some((day) => day.weekday === 4));

console.log("\nTimezone: the Manila weekday decides, not UTC or the device");
// 00:30 Thursday in Manila is still Wednesday 16:30 in UTC.
const earlyThursday = at(THU, "00:30").toISOString();
check("the instant is a Wednesday in UTC", new Date(earlyThursday).getUTCDay() === 3);
const disguised = pick(PRENATAL, WED, earlyThursday);
check("a Thursday time sent under a Wednesday date is refused", disguised?.statusCode === 400, disguised?.message);
const lateWednesday = pick(PRENATAL, THU, at(WED, "15:40").toISOString());
check("a Wednesday time sent under a Thursday date is refused as Thursday", lateWednesday?.message === THURSDAY_MESSAGE, lateWednesday?.message);

console.log("\nOther days keep every other rule");
const wednesday = positionStarts(PRENATAL, dayStartOf(WED)).map((d) => d.toTimeString().slice(0, 5));
check("20-minute slots, 08:00 to 11:40 and 13:00 to 15:40", wednesday.length === 21 && wednesday[0] === "08:00" && wednesday.includes("11:40") && !wednesday.includes("12:00") && wednesday.at(-1) === "15:40", wednesday.join(" "));
check("a valid Wednesday slot is accepted", pick(PRENATAL, WED, at(WED, "13:20").toISOString()) === null);
check("the last slot ends exactly at closing and is accepted", pick(PRENATAL, WED, at(WED, "15:40").toISOString()) === null);
check("a start that would run past closing is refused", pick(PRENATAL, WED, at(WED, "15:50").toISOString())?.statusCode === 400);
check("a start in the lunch break is refused", pick(PRENATAL, WED, at(WED, "12:00").toISOString())?.statusCode === 400);
check("an off-grid start is refused", pick(PRENATAL, WED, at(WED, "08:10").toISOString())?.statusCode === 400);
check("Saturday is mornings only", positionStarts(PRENATAL, dayStartOf(SAT)).every((d) => d.getHours() < 12));
check("Sunday stays closed with the general message", /Mondays/.test(pick(PRENATAL, "2026-11-15", at("2026-11-15", "09:00").toISOString())?.message ?? ""));
const full = describeDay({
  categoryKey: PRENATAL,
  dayStart: dayStartOf(WED),
  booked: positionStarts(PRENATAL, dayStartOf(WED)).map((start, i) => ({ _id: `b${i}`, slotStart: start, slotEnd: new Date(start.getTime() + 20 * 60000) })),
  now: NOW,
});
check("a day with every slot booked is full, not open", full.status === DAY_STATUS.FULL && full.openSlots === 0);

console.log("\nThe Thursday rule is prenatal's alone");
check("BP checking still runs on Thursdays", pick("bp_checking", THU, at(THU, "09:00").toISOString()) === null);
check("BP checking has no closed-day reasons", scheduleSummary("bp_checking", NOW).closedDays.length === 0);

console.log("\nOlder Thursday prenatal visits are reported, not changed");
const rows = [
  { _id: "a", status: "confirmed", slotStart: at(THU, "09:00"), missionSchedule: "m1" },
  { _id: "b", status: "completed", slotStart: at("2026-10-29", "10:00"), missionSchedule: "m2" },
  { _id: "c", status: "confirmed", slotStart: at(WED, "09:00"), missionSchedule: null },
  { _id: "d", status: "pending", slotStart: null },
];
const found = visitsOnClosedDays(PRENATAL, rows);
check("only the Thursday visits are listed", found.map((row) => row.id).join(",") === "a,b");
check("active and historical visits are told apart", found[0].active === true && found[1].active === false);
check("the report carries no names or reasons", found.every((row) => Object.keys(row).join(",") === "id,status,slotStart,weekday,active,onMission"));

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
