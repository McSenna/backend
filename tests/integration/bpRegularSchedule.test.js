"use strict";

// BP checking on its own Monday to Saturday schedule, with no medical mission.
// Same-day elapsed slots and the per-weekday rules are covered in
// tests/unit/regularSchedule.test.js, which can fix the clock.

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish, DAY_MS } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");

const iso = (date) => new Date(date).toISOString();
let keyCount = 0;
const newKey = () => `bp-key-${Date.now().toString(36)}-${(keyCount += 1)}`;

/** Holds every insert back, so racing requests all read availability before any writes. */
const withSlowInserts = async (work) => {
  const original = Appointment.create;
  Appointment.create = async function delayedCreate(...args) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return original.apply(this, args);
  };
  try {
    return await work();
  } finally {
    Appointment.create = original;
  }
};

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const residents = [];
  for (let i = 0; i < 9; i += 1) residents.push(await createUser("resident"));
  const [alice, bea, cara, dee, ...racers] = residents;

  const MON = upcomingDateKey(1, 1);
  const TUE = upcomingDateKey(2, 1);
  const THU = upcomingDateKey(4, 1);
  const SAT = upcomingDateKey(6, 1);
  const SUN = upcomingDateKey(0, 1);
  const monthOf = (key) => key.slice(0, 7);

  const options = (who, query = "") => request(`/appointments/booking-options?consultationType=bp_checking${query}`, { token: who.token });
  const book = (who, body) => request("/appointments", { method: "POST", token: who.token, body });
  const bp = (appointmentDate, time, extra = {}) => ({
    consultationType: "bp_checking",
    description: "Monthly reading",
    appointmentDate,
    slotStart: iso(localAt(appointmentDate, time)),
    requestKey: newKey(),
    ...extra,
  });

  console.log("\nBP booking works with no medical mission at all");
  check("there are no missions in the database", (await MissionSchedule.countDocuments()) === 0);
  const opened = await options(alice);
  check("booking options load", opened.status === 200 && opened.body.scheduling === "regular", `${opened.status} ${opened.body.message}`);
  check("the current month is listed with a chosen first open day", Boolean(opened.body.month?.days?.length) && opened.body.day?.status === "open");
  const monday = (await options(alice, `&date=${MON}`)).body;
  check("a weekday offers 42 slots before bookings", monday.day.totalSlots === 42 && monday.day.slots.length === 42, `${monday.day.totalSlots}/${monday.day.slots.length}`);
  check("the first slot is 8:00 and the last 3:50", monday.day.slots[0].time === "08:00" && monday.day.slots.at(-1).time === "15:50");
  check("no slot starts in the lunch break", monday.day.slots.every((slot) => !slot.time.startsWith("12:")));
  const saturday = (await options(alice, `&date=${SAT}`)).body.day;
  check("Saturday offers 24 slots (half day)", saturday.totalSlots === 24 && saturday.slots.at(-1).time === "11:50");
  const sunday = (await options(alice, `&date=${SUN}`)).body.day;
  check("Sunday is closed with no slots", sunday.status === "closed" && sunday.slots.length === 0);
  const yesterdayKey = new Date(Date.now() - DAY_MS + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  check("a past date is listed as past", (await options(alice, `&date=${yesterdayKey}`)).body.day.status === "past");
  const nextMonth = (await options(alice, `&month=${monthOf(upcomingDateKey(1, 6))}`)).body;
  check("a later month loads without choosing a day", nextMonth.month.days.length >= 28 && nextMonth.day === null);
  check("a malformed month is refused", (await options(alice, "&month=2026-13")).status === 400);
  check("a malformed date is refused", (await options(alice, "&date=2026-02-30")).status === 400);

  const first = await book(alice, bp(MON, "09:00"));
  check("a resident books a BP slot without a mission", first.status === 201 && first.body.appointment.status === "confirmed", `${first.status} ${first.body.message}`);
  const stored = await Appointment.findById(first.body.appointment._id).lean();
  check("it is stored with no mission and a 10-minute slot", stored.missionSchedule === null && stored.slotEnd - stored.slotStart === 600000);
  check("its slot key is namespaced to BP", stored.immunizationSlotKey === `bp_checking:${iso(localAt(MON, "09:00"))}`);
  const afterFirst = (await options(bea, `&date=${MON}`)).body.day;
  check("the booked slot disappears for others", afterFirst.slots.length === 41 && !afterFirst.slots.some((slot) => slot.time === "09:00"));

  console.log("\nThe API refuses what the schedule does not allow, however it is sent");
  for (const [label, body] of [
    ["12:00 (lunch break)", bp(MON, "12:00")],
    ["12:30 (lunch break)", bp(MON, "12:30")],
    ["4:00 PM (closing)", bp(MON, "16:00")],
    ["8:05 (off the interval)", bp(MON, "08:05")],
    ["1:00 PM on Saturday", bp(SAT, "13:00")],
    ["a Sunday", bp(SUN, "09:00")],
    ["a past date", bp(yesterdayKey, "09:00")],
    ["a time on another date", { ...bp(MON, "09:00"), slotStart: iso(localAt(TUE, "09:00")) }],
    ["no date", { ...bp(MON, "09:30"), appointmentDate: undefined }],
    ["no reason", { ...bp(MON, "09:30"), description: "" }],
  ]) {
    const res = await book(bea, body);
    check(`${label} is refused`, res.status === 400, `${res.status} ${res.body.message}`);
  }
  check("none of them was saved", (await Appointment.countDocuments({ resident: bea.user._id })) === 0);
  const ignoredMission = await book(bea, bp(MON, "09:30", { missionScheduleId: "6a0000000000000000000000" }));
  check("a mission id in the body is ignored", ignoredMission.status === 201 && ignoredMission.body.appointment.missionSchedule == null);

  console.log("\nCapacity, duplicates and retries");
  const taken = await book(cara, bp(MON, "09:00"));
  check("a taken slot is refused with a clear message", taken.status === 409 && taken.body.code === "SLOT_UNAVAILABLE" && /just booked/.test(taken.body.message), `${taken.status} ${taken.body.message}`);
  const twice = await book(alice, bp(MON, "14:00"));
  check("a second BP visit the same day is refused", twice.status === 409 && twice.body.code === "DUPLICATE_BOOKING");
  const replayBody = bp(TUE, "10:00");
  const replayA = await book(cara, replayBody);
  const replayB = await book(cara, replayBody);
  check("a retry with the same key returns the first booking", replayA.status === 201 && replayB.status === 200 && replayA.body.appointment._id === replayB.body.appointment._id);

  console.log("\nSimultaneous bookings of one slot");
  const raceBody = (who) => bp(TUE, "11:00", { requestKey: `race-${String(who.user._id)}` });
  const results = await withSlowInserts(() => Promise.all(racers.map((who) => book(who, raceBody(who)))));
  check("exactly one racer gets the slot", results.filter((res) => res.status === 201).length === 1, results.map((res) => res.status).join());
  check("every other racer is told it was taken", results.filter((res) => res.status === 409 && res.body.code === "SLOT_UNAVAILABLE").length === racers.length - 1);
  check("only one appointment holds that slot", (await Appointment.countDocuments({ consultationType: "bp_checking", slotStart: localAt(TUE, "11:00"), status: "confirmed" })) === 1);
  const spreadTimes = ["08:00", "09:00", "10:00", "11:00", "13:00"];
  const spread = await withSlowInserts(() => Promise.all(racers.map((who, i) => book(who, bp(THU, spreadTimes[i])))));
  check("racers on different slots all succeed", spread.every((res) => res.status === 201), spread.map((res) => res.status).join());

  console.log("\nCancelling frees the slot; immunization never collides");
  const cancel = await request(`/appointments/${first.body.appointment._id}/cancel`, { method: "PATCH", token: alice.token, body: {} });
  check("the resident can cancel", cancel.status === 200);
  check("the cancelled slot can be booked again", (await book(dee, bp(MON, "09:00"))).status === 201);
  await Appointment.create({ resident: dee.user._id, consultationType: "immunization", childName: "Fictional test child", ageTier: 0, prioritySortKey: 0, status: "confirmed", slotStart: localAt(THU, "14:00"), slotEnd: localAt(THU, "14:10"), immunizationSlotKey: iso(localAt(THU, "14:00")) });
  check("BP books the same instant as an immunization visit", (await book(alice, bp(THU, "14:00"))).status === 201);

  console.log("\nReschedule on the same schedule");
  const mine = replayA.body.appointment._id;
  const moveOptions = await request(`/appointments/${mine}/reschedule-options?date=${TUE}`, { token: cara.token });
  check("reschedule options are the BP calendar", moveOptions.status === 200 && moveOptions.body.scheduling === "regular" && moveOptions.body.day.slots.some((slot) => slot.time === "10:00"));
  const move = (body) => request(`/appointments/${mine}/reschedule`, { method: "PATCH", token: cara.token, body });
  check("moving to a taken slot is refused", (await move({ appointmentDate: TUE, slotStart: iso(localAt(TUE, "11:00")) })).status === 409);
  check("moving to a Sunday is refused", (await move({ appointmentDate: SUN, slotStart: iso(localAt(SUN, "09:00")) })).status === 400);
  check("moving onto the same time is refused", (await move({ appointmentDate: TUE, slotStart: iso(localAt(TUE, "10:00")) })).status === 409);
  const moved = await move({ appointmentDate: SAT, slotStart: iso(localAt(SAT, "08:30")) });
  check("moving to an open Saturday slot works", moved.status === 200 && moved.body.appointment.status === "rescheduled" && iso(moved.body.appointment.slotStart) === iso(localAt(SAT, "08:30")), `${moved.status} ${moved.body.message}`);
  check("the old slot is free again", (await options(bea, `&date=${TUE}`)).body.day.slots.some((slot) => slot.time === "10:00"));
  check("another resident cannot move it", (await request(`/appointments/${mine}/reschedule`, { method: "PATCH", token: bea.token, body: { appointmentDate: SAT, slotStart: iso(localAt(SAT, "09:00")) } })).status === 403);

  console.log("\nMissions stay as they were for other services");
  const bpMission = await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: THU, categories: [{ categoryKey: "bp_checking", durationMinutes: 10 }] } });
  check("a mission can no longer list BP checking", bpMission.status === 400 && /own schedule/.test(bpMission.body.message));
  const general = await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: THU, categories: [{ categoryKey: "general_checkup", durationMinutes: 20 }] } });
  check("a general checkup mission is still created", general.status === 201);
  const generalOptions = await request("/appointments/booking-options?consultationType=general_checkup", { token: alice.token });
  check("general checkup is a queued service with no times to pick", generalOptions.body.scheduling === "queue");

  console.log("\nAn older BP visit booked on a mission keeps its time");
  const legacyMission = await MissionSchedule.collection.insertOne({ date: localAt(MON, "00:00"), categories: [{ categoryKey: "bp_checking", durationMinutes: 5 }], createdBy: doctor.user._id, morningStart: "08:00", morningEnd: "12:00", afternoonStart: "13:00", afternoonEnd: "17:00" });
  const legacy = await Appointment.create({ resident: bea.user._id, consultationType: "bp_checking", description: "Older mission visit", status: "confirmed", ageTier: 3, prioritySortKey: 3, missionSchedule: legacyMission.insertedId, slotStart: localAt(MON, "10:05"), slotEnd: localAt(MON, "10:10") });
  const legacyDay = (await options(alice, `&date=${MON}`)).body.day;
  check("it blocks the overlapping 10:00 slot", !legacyDay.slots.some((slot) => slot.time === "10:00"));
  const kept = await Appointment.findById(legacy._id).lean();
  check("it is not moved or changed", kept.status === "confirmed" && iso(kept.slotStart) === iso(localAt(MON, "10:05")) && String(kept.missionSchedule) === String(legacyMission.insertedId));

  console.log("\nStaff place an older pending BP request on the regular schedule");
  // Assigning stays with doctor, midwife and admin (STAFF_ADMIN); BHWs never had it.
  const admin = await createUser("admin");
  const pending = await Appointment.create({ resident: dee.user._id, consultationType: "bp_checking", description: "Older request", status: "pending", ageTier: 3, prioritySortKey: 3 });
  const placed = await request(`/appointments/${pending._id}/assign`, { method: "PATCH", token: admin.token, body: {} });
  const placedRow = await Appointment.findById(pending._id).lean();
  check("an admin places it on the first open slot", placed.status === 200 && placedRow.status === "confirmed" && placedRow.missionSchedule === null, `${placed.status} ${placed.body.message}`);
  check("the placed slot is a valid BP start with a BP slot key", placedRow.slotEnd - placedRow.slotStart === 600000 && placedRow.immunizationSlotKey === `bp_checking:${iso(placedRow.slotStart)}`);
};

(async () => {
  const { check, tally } = createChecker();
  const harness = await startHarness();
  try {
    await run(harness, check);
  } catch (error) {
    check("suite ran without an unexpected error", false, error?.stack);
  }
  await finish(harness, tally);
})();
