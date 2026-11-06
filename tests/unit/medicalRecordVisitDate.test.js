"use strict";

const { readVisitDate } = require("../../services/medicalRecord/masterlistPayload");

let failed = 0;
const check = (name, condition, detail = "") => {
  if (!condition) failed += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

const read = (raw, today) => {
  const fieldErrors = {};
  const date = readVisitDate(raw, fieldErrors, today);
  return { date, fieldErrors };
};

// 01:30 in Manila on 2026-11-06 is 17:30 UTC on 2026-11-05: today's UTC
// midnight is still ahead of the clock, yet the visit happened today.
const earlyMorning = read("2026-11-06", "2026-11-06");
check("a visit dated today is accepted before 08:00 Manila", earlyMorning.date !== null, JSON.stringify(earlyMorning.fieldErrors));

const tomorrow = read("2026-11-07", "2026-11-06");
check("a visit dated tomorrow is refused", tomorrow.date === null && Boolean(tomorrow.fieldErrors.visitDate));

const ancient = read("1899-12-31", "2026-11-06");
check("a visit before 1900 is refused", ancient.date === null && Boolean(ancient.fieldErrors.visitDate));

const malformed = read("2026-02-30", "2026-11-06");
check("an impossible date is refused", malformed.date === null && Boolean(malformed.fieldErrors.visitDate));

process.exit(failed > 0 ? 1 : 0);
