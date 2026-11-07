"use strict";

process.env.TZ = "Asia/Manila";

const { residentPicksTime, isWeeklyService } = require("../../config/consultationCategories");
const { dayStartOf, positionStarts } = require("../../services/immunization/weeklyCalendar");
const { DAY_STATUS, describeDay, openStartsOn, scheduleSummary, toSlot, monthStartOf } = require("../../services/regularSchedule/calendar");
const { parseRegularStart, parseRegularRequest } = require("../../services/regularSchedule/request");
const { assertMissionService } = require("../../services/appointment/missionServiceRules");

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

const BP = "bp_checking";
const at = (day, time) => new Date(`${day}T${time}:00+08:00`);
const clock = (date) => date.toTimeString().slice(0, 5);
// Fixed fictional week: Mon 2026-11-09 to Sun 2026-11-15.
const MON = "2026-11-09";
const SAT = "2026-11-14";
const SUN = "2026-11-15";
const FRIDAY_BEFORE = at("2026-11-06", "15:00");
const day = (key, booked = [], now = FRIDAY_BEFORE) => describeDay({ categoryKey: BP, dayStart: dayStartOf(key), booked, now });
const visit = (id, key, time, minutes = 10) => ({ _id: id, slotStart: at(key, time), slotEnd: new Date(at(key, time).getTime() + minutes * 60000) });
const start = (appointmentDate, time, now = FRIDAY_BEFORE) => thrown(() => parseRegularStart(BP, { appointmentDate, slotStart: at(appointmentDate, time).toISOString() }, now));

console.log("\nBP checking is its own regular schedule, never a mission service");
check("BP checking is a weekly service where the resident picks the time", isWeeklyService(BP) && residentPicksTime(BP));
check("immunization keeps its assigned time", isWeeklyService("immunization") && !residentPicksTime("immunization"));
check("doctor services stay mission services", !residentPicksTime("general_checkup") && !isWeeklyService("consultation"));
check("a mission may not list BP checking", /own schedule/.test(thrown(() => assertMissionService(BP))?.message ?? ""));

console.log("\nWeekday schedule: 42 slots, lunch break excluded");
const weekday = positionStarts(BP, dayStartOf(MON));
check("42 possible slots on a full weekday", weekday.length === 42, `${weekday.length}`);
check("morning runs 8:00 to 11:50", clock(weekday[0]) === "08:00" && clock(weekday[23]) === "11:50");
check("afternoon runs 1:00 to 3:50", clock(weekday[24]) === "13:00" && clock(weekday[41]) === "15:50");
check("no start falls in the 12:00 to 1:00 lunch break", weekday.every((s) => s.getHours() !== 12));
check("every slot is 10 minutes apart within a window", weekday.every((s, i) => i === 0 || i === 24 || s - weekday[i - 1] === 600000));
check("every slot ends by lunch or closing", weekday.every((s) => { const end = s.getHours() * 60 + s.getMinutes() + 10; return end <= 12 * 60 || (s.getHours() >= 13 && end <= 16 * 60); }));
for (const weekdayKey of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
  check(`${weekdayKey} also has 42`, positionStarts(BP, dayStartOf(weekdayKey)).length === 42);
}

console.log("\nSaturday half day (assumed 8:00 to 12:00)");
const saturday = positionStarts(BP, dayStartOf(SAT));
check("24 possible slots on a Saturday", saturday.length === 24, `${saturday.length}`);
check("Saturday runs 8:00 to 11:50 only", clock(saturday[0]) === "08:00" && clock(saturday.at(-1)) === "11:50");

console.log("\nSunday closure");
check("Sunday is closed with no slots", day(SUN).status === DAY_STATUS.CLOSED && day(SUN).totalSlots === 0 && day(SUN).openSlots === 0);
check("booking a Sunday is refused", /only available on/.test(start(SUN, "09:00")?.message ?? ""));

console.log("\nStart times the schedule refuses");
for (const [time, why] of [["12:00", "noon (lunch)"], ["12:30", "inside lunch"], ["16:00", "closing time"], ["07:50", "before opening"], ["08:05", "off the 10-minute interval"], ["15:55", "off-interval near closing"]]) {
  const error = start(MON, time);
  check(`${time} is refused: ${why}`, error?.statusCode === 400 && /not one of/.test(error.message), error?.message);
}
check("12:00 on Saturday is refused", start(SAT, "12:00")?.statusCode === 400);
check("1:00 PM on Saturday is refused (half day)", start(SAT, "13:00")?.statusCode === 400);
check("a valid weekday start is accepted", start(MON, "15:50") === null);
check("a valid Saturday start is accepted", start(SAT, "11:50") === null);
check("a time on another date than the chosen one is refused", /not on the chosen date/.test(thrown(() => parseRegularStart(BP, { appointmentDate: MON, slotStart: at("2026-11-10", "09:00").toISOString() }, FRIDAY_BEFORE))?.message ?? ""));
check("an impossible date is refused", thrown(() => parseRegularStart(BP, { appointmentDate: "2026-02-30", slotStart: at(MON, "09:00").toISOString() }))?.statusCode === 400);
check("a missing time is refused", thrown(() => parseRegularStart(BP, { appointmentDate: MON }))?.statusCode === 400);
check("a reason is required", thrown(() => parseRegularRequest(BP, { appointmentDate: MON, slotStart: at(MON, "09:00").toISOString() }, FRIDAY_BEFORE))?.statusCode === 400);

console.log("\nPast dates and same-day elapsed slots");
const mondayMidMorning = at(MON, "09:05");
check("yesterday is a past date", day("2026-11-08", [], mondayMidMorning).status === DAY_STATUS.PAST);
check("booking a past date is refused", /has passed/.test(start("2026-11-07", "09:00", mondayMidMorning)?.message ?? ""));
const today = day(MON, [], mondayMidMorning);
check("today stays open while times remain", today.status === DAY_STATUS.OPEN);
check("slots before now are removed (9:10 is first at 9:05)", clock(today.open[0]) === "09:10" && today.openSlots === 42 - 7, `${today.openSlots}`);
check("a slot that already started is refused", /already passed/.test(start(MON, "09:00", mondayMidMorning)?.message ?? ""));
check("the next slot today is accepted", start(MON, "09:10", mondayMidMorning) === null);
check("after the last start today ends with no slots", day(MON, [], at(MON, "15:51")).status === DAY_STATUS.ENDED);
check("booking today after closing is refused", /all passed/.test(start(MON, "15:50", at(MON, "15:55"))?.message ?? ""));
check("Saturday afternoon has no times left that day", day(SAT, [], at(SAT, "12:30")).status === DAY_STATUS.ENDED);

console.log("\nCapacity: one appointment per slot");
const taken = [visit("a", MON, "08:00"), visit("b", MON, "13:00")];
const withTaken = day(MON, taken);
check("taken slots are not offered", withTaken.openSlots === 40 && !withTaken.open.some((s) => clock(s) === "08:00" || clock(s) === "13:00"));
check("an older 5-minute mission visit at 8:05 blocks 8:00", !day(MON, [visit("m", MON, "08:05", 5)]).open.some((s) => clock(s) === "08:00"));
check("your own slot does not block your reschedule", openStartsOn({ categoryKey: BP, dayStart: dayStartOf(MON), booked: taken, now: FRIDAY_BEFORE, excludeAppointmentId: "a" }).length === 41);
const fullDay = weekday.map((s, i) => ({ _id: `f${i}`, slotStart: s, slotEnd: new Date(s.getTime() + 600000) }));
check("a fully booked day is full, not closed", day(MON, fullDay).status === DAY_STATUS.FULL && day(MON, fullDay).openSlots === 0);

console.log("\nWhat the API tells the app");
const summary = scheduleSummary(BP, FRIDAY_BEFORE);
check("the summary lists Monday to Saturday", summary.weekdays.map((w) => w.weekday).join() === "1,2,3,4,5,6");
check("weekdays have two windows, Saturday one", summary.weekdays[0].windows.length === 2 && summary.weekdays[5].windows.length === 1);
check("no booking horizon is invented", summary.bookingHorizonWeeks === null && summary.lastBookableDate === null);
check("today is the app-timezone date", summary.today === "2026-11-06");
const slot = toSlot(BP, at(MON, "13:20"));
check("a slot carries its wall-clock time and half of day", slot.time === "13:20" && slot.period === "afternoon" && new Date(slot.end) - new Date(slot.start) === 600000);
check("a far-future month is still bookable (no horizon)", day("2027-03-01", [], FRIDAY_BEFORE).status === DAY_STATUS.OPEN);
check("month keys outside 2000 to 2100 are refused", monthStartOf("2026-11") !== null && monthStartOf("2026-13") === null && monthStartOf("9999-01") === null);

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
