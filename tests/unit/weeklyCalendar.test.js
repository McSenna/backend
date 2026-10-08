"use strict";

process.env.TZ = "Asia/Manila";

const { dayStartOf, dayKeyOf, positionStarts, upcomingDays } = require("../../services/immunization/weeklyCalendar");
const { openStarts } = require("../../services/immunization/weeklySlots");
const { isWeeklyService } = require("../../config/consultationCategories");

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

const at = (day, time) => new Date(`${day}T${time}:00+08:00`);
const THU = "2026-10-08";
const visit = (id, time) => ({ _id: id, slotStart: at(THU, time), slotEnd: new Date(at(THU, time).getTime() + 600000) });

console.log("\nWhich services run on their own weekly schedule");
check("immunization does", isWeeklyService("immunization"));
for (const key of ["general_checkup", "consultation", "prenatal", "bp_checking", "unknown"]) check(`${key} does not`, !isWeeklyService(key));

console.log("\nDay keys");
check("a real date parses to local midnight", dayStartOf(THU)?.getTime() === at(THU, "00:00").getTime());
check("an impossible date is rejected", dayStartOf("2026-02-30") === null && dayStartOf("07/10/2026") === null && dayStartOf("") === null);
check("the key round-trips", dayKeyOf(dayStartOf(THU)) === THU);

console.log("\nPositions: 8:00 to 11:50, ten minutes apart");
const starts = positionStarts("immunization", dayStartOf(THU));
check("24 positions in the morning window", starts.length === 24, `${starts.length}`);
check("the first is 8:00 and the last 11:50", starts[0].getTime() === at(THU, "08:00").getTime() && starts.at(-1).getTime() === at(THU, "11:50").getTime());
check("each is exactly 10 minutes after the last", starts.every((s, i) => i === 0 || s - starts[i - 1] === 600000));

console.log("\nBooking window: Thursdays in the next 8 weeks");
const wednesdayNoon = at("2026-10-07", "12:00");
const days = upcomingDays("immunization", wednesdayNoon);
check("8 Thursdays, starting tomorrow", days.length === 8 && dayKeyOf(days[0]) === THU && days.every((d) => d.getDay() === 4), days.map(dayKeyOf).join());
check("a Thursday whose last position has started is left out", dayKeyOf(upcomingDays("immunization", at(THU, "11:51"))[0]) === "2026-10-15");
check("this Thursday still counts before 11:50", dayKeyOf(upcomingDays("immunization", at(THU, "09:05"))[0]) === THU);

console.log("\nFirst come, first served: the earliest open position");
const now = wednesdayNoon;
const day = dayStartOf(THU);
check("an empty day starts at 8:00", openStarts({ categoryKey: "immunization", dayStart: day, booked: [], now })[0].getTime() === at(THU, "08:00").getTime());
check("8:00 and 8:10 taken: 8:20 is next", openStarts({ categoryKey: "immunization", dayStart: day, booked: [visit("a", "08:00"), visit("b", "08:10")], now })[0].getTime() === at(THU, "08:20").getTime());
check("a released 8:10 between taken times is offered first", openStarts({ categoryKey: "immunization", dayStart: day, booked: [visit("a", "08:00"), visit("c", "08:20")], now })[0].getTime() === at(THU, "08:10").getTime());
check("your own position does not block you", openStarts({ categoryKey: "immunization", dayStart: day, booked: [visit("me", "08:00")], now, excludeAppointmentId: "me" })[0].getTime() === at(THU, "08:00").getTime());
check("times already passed today are skipped", openStarts({ categoryKey: "immunization", dayStart: day, booked: [], now: at(THU, "09:03") })[0].getTime() === at(THU, "09:10").getTime());
const full = starts.map((s, i) => ({ _id: `f${i}`, slotStart: s, slotEnd: new Date(s.getTime() + 600000) }));
check("a full day has no open position", openStarts({ categoryKey: "immunization", dayStart: day, booked: full, now }).length === 0);

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
