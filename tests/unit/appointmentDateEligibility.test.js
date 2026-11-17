"use strict";

// Deliberately NOT Manila: the rule must read the business calendar day from
// its own time zone, never from the server process clock.
process.env.TZ = "America/Los_Angeles";

const assert = require("node:assert/strict");
const { calendarDayIn, BUSINESS_TIME_ZONE } = require("../../utils/businessCalendar");
const { assertCompletionDayReached } = require("../../services/appointment/serviceDayRules");
const { ERROR_CODES } = require("../../utils/errorCodes");

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
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

const manila = (dateKey, time = "00:00:00.000") => new Date(`${dateKey}T${time}+08:00`);
const visit = (consultationType, slotStart) => ({ consultationType, slotStart });

console.log("\nBusiness calendar day");
check("the business zone defaults to Asia/Manila", () => assert.equal(BUSINESS_TIME_ZONE, "Asia/Manila"));
check("UTC and Manila fall on different days before 08:00 Manila", () => {
  const instant = new Date("2026-11-13T20:30:00.000Z");
  assert.equal(calendarDayIn(instant, "UTC"), "2026-11-13");
  assert.equal(calendarDayIn(instant), "2026-11-14");
});
check("the process clock zone does not change the answer", () => {
  assert.equal(new Date("2026-11-13T20:30:00.000Z").getDate(), 13, "test runs in Los Angeles time");
  assert.equal(calendarDayIn(new Date("2026-11-13T20:30:00.000Z")), "2026-11-14");
});
check("year boundary", () => assert.equal(calendarDayIn(new Date("2026-12-31T16:00:00.000Z")), "2027-01-01"));
check("leap day", () => assert.equal(calendarDayIn(new Date("2028-02-28T16:00:00.000Z")), "2028-02-29"));
check("a daylight saving zone keeps its local day across the change", () => {
  assert.equal(calendarDayIn(new Date("2026-03-08T06:59:00.000Z"), "America/New_York"), "2026-03-08");
  assert.equal(calendarDayIn(new Date("2026-11-01T04:30:00.000Z"), "America/New_York"), "2026-11-01");
});
check("unreadable dates resolve to null", () => {
  assert.equal(calendarDayIn(null), null);
  assert.equal(calendarDayIn("not a date"), null);
  assert.equal(calendarDayIn(new Date(Number.NaN)), null);
});

console.log("\nDoctor services open on their scheduled calendar day");
for (const service of ["general_checkup", "consultation"]) {
  const slot = manila("2026-11-20", "15:00:00.000");

  check(`${service}: tomorrow is blocked with APPOINTMENT_DATE_NOT_REACHED`, () => {
    const error = thrown(() => assertCompletionDayReached(visit(service, slot), manila("2026-11-19", "10:00:00.000")));
    assert.equal(error?.statusCode, 409);
    assert.equal(error.code, ERROR_CODES.APPOINTMENT_DATE_NOT_REACHED);
    assert.deepEqual(error.details, { scheduledDate: "2026-11-20", timeZone: "Asia/Manila" });
    assert.match(error.message, /starting on Fri, Nov 20/);
  });
  check(`${service}: the last moment before the day is blocked`, () => {
    assert.ok(thrown(() => assertCompletionDayReached(visit(service, slot), manila("2026-11-19", "23:59:59.999"))));
  });
  check(`${service}: the first moment of the day is eligible, hours before the 3 PM slot`, () => {
    assert.equal(thrown(() => assertCompletionDayReached(visit(service, slot), manila("2026-11-20"))), null);
  });
  check(`${service}: 9 AM on the day is eligible`, () => {
    assert.equal(thrown(() => assertCompletionDayReached(visit(service, slot), manila("2026-11-20", "09:00:00.000"))), null);
  });
  check(`${service}: a past day stays eligible`, () => {
    assert.equal(thrown(() => assertCompletionDayReached(visit(service, slot), manila("2026-12-02"))), null);
  });
  check(`${service}: no scheduled date is a controlled rejection`, () => {
    const error = thrown(() => assertCompletionDayReached(visit(service, null), manila("2026-11-20")));
    assert.equal(error?.statusCode, 409);
    assert.equal(error.code, ERROR_CODES.APPOINTMENT_DATE_NOT_REACHED);
    assert.equal(error.details.scheduledDate, null);
  });
  check(`${service}: an unreadable scheduled date is rejected, not allowed`, () => {
    const error = thrown(() => assertCompletionDayReached(visit(service, "garbage"), manila("2026-11-20")));
    assert.equal(error?.code, ERROR_CODES.APPOINTMENT_DATE_NOT_REACHED);
  });
}

check("a slot stored as UTC midnight still reads as its Manila day", () => {
  // 2026-11-19T16:00Z is 00:00 on Nov 20 in Manila but Nov 19 in UTC.
  const slot = new Date("2026-11-19T16:00:00.000Z");
  assert.ok(thrown(() => assertCompletionDayReached(visit("consultation", slot), manila("2026-11-19", "23:00:00.000"))));
  assert.equal(thrown(() => assertCompletionDayReached(visit("consultation", slot), manila("2026-11-20", "00:00:00.000"))), null);
});

console.log("\nOther services keep their existing rules");
check("immunization stays locked to its day, now with the shared code", () => {
  const error = thrown(() =>
    assertCompletionDayReached(visit("immunization", manila("2026-11-19", "09:00:00.000")), manila("2026-11-18", "12:00:00.000"))
  );
  assert.equal(error?.code, ERROR_CODES.APPOINTMENT_DATE_NOT_REACHED);
});
for (const service of ["bp_checking", "prenatal"]) {
  check(`${service} can still be signed off ahead of its slot`, () => {
    assert.equal(
      thrown(() => assertCompletionDayReached(visit(service, manila("2026-11-20")), manila("2026-11-16"))),
      null
    );
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
