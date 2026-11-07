"use strict";

// Prenatal on the health center hours with no Thursdays (the midwife runs
// immunization then), booked and moved by the resident. Weekday, closing-time
// and timezone rules with a fixed clock are in tests/unit/prenatalSchedule.test.js.

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");

const THURSDAY_MESSAGE =
  "Prenatal appointments are unavailable on Thursdays because the midwife is assigned to immunization services. Please choose another available day.";
const iso = (date) => new Date(date).toISOString();
let keyCount = 0;
const newKey = () => `pn-key-${Date.now().toString(36)}-${(keyCount += 1)}`;

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const [alice, bea] = [await createUser("resident"), await createUser("resident")];
  const WED = upcomingDateKey(3, 1);
  const THU = upcomingDateKey(4, 1);
  const FRI = upcomingDateKey(5, 1);

  const options = (who, query = "") => request(`/appointments/booking-options?consultationType=prenatal${query}`, { token: who.token });
  const book = (who, body) => request("/appointments", { method: "POST", token: who.token, body });
  const prenatal = (appointmentDate, time, extra = {}) => ({
    consultationType: "prenatal",
    description: "Second trimester check",
    appointmentDate,
    slotStart: iso(localAt(appointmentDate, time)),
    requestKey: newKey(),
    ...extra,
  });

  console.log("\nPrenatal is booked on its own calendar, with no mission");
  const opened = await options(alice, `&date=${WED}`);
  check("options are the regular calendar", opened.status === 200 && opened.body.scheduling === "regular", `${opened.status} ${opened.body.message}`);
  check("a Wednesday offers 21 twenty-minute slots", opened.body.day.totalSlots === 21 && opened.body.schedule.intervalMinutes === 20);
  check("the schedule explains the Thursday closure", opened.body.schedule.closedDays?.[0]?.reason === THURSDAY_MESSAGE);
  const thursday = (await options(alice, `&date=${THU}`)).body.day;
  check("Thursday is closed with no slots", thursday.status === "closed" && thursday.slots.length === 0);
  const month = (await options(alice, `&month=${THU.slice(0, 7)}`)).body.month.days;
  const thursdays = month.filter((d) => new Date(`${d.dateKey}T12:00:00+08:00`).getDay() === 4);
  check(
    "no Thursday in the month is bookable: each is closed, or past",
    thursdays.length >= 4 && thursdays.every((d) => d.status === "closed" || d.status === "past") && thursdays.some((d) => d.status === "closed"),
    thursdays.map((d) => `${d.dateKey}:${d.status}`).join(" ")
  );

  const booked = await book(alice, prenatal(WED, "09:00"));
  const stored = await Appointment.findById(booked.body.appointment?._id).lean();
  check("a resident books a valid Wednesday slot", booked.status === 201 && stored?.status === "confirmed" && stored.missionSchedule === null, `${booked.status} ${booked.body.message}`);
  check("it holds 20 minutes", stored && stored.slotEnd - stored.slotStart === 20 * 60000);
  const midwifeQueue = (await request("/appointments?status=confirmed", { token: midwife.token })).body.appointments ?? [];
  check("the midwife sees it in her list", midwifeQueue.some((a) => String(a._id) === String(stored?._id) && a.queueRole === "midwife"));
  const doctorQueue = (await request("/appointments?status=confirmed", { token: doctor.token })).body.appointments ?? [];
  check("the doctor's list does not", !doctorQueue.some((a) => String(a._id) === String(stored?._id)));

  console.log("\nThursday is refused however the request is sent");
  const direct = await book(bea, prenatal(THU, "09:00"));
  check("a direct API booking on Thursday is refused with the reason", direct.status === 400 && direct.body.message === THURSDAY_MESSAGE, `${direct.status} ${direct.body.message}`);
  const disguised = await book(bea, { ...prenatal(WED, "09:00"), slotStart: iso(localAt(THU, "00:20")) });
  check("a Thursday time under a Wednesday date is refused", disguised.status === 400);
  const missionId = await book(bea, prenatal(THU, "09:00", { missionScheduleId: "6a0000000000000000000000" }));
  check("adding a mission id does not get around it", missionId.status === 400);
  check("nothing was saved for those attempts", (await Appointment.countDocuments({ resident: bea.user._id })) === 0);

  console.log("\nOther limits still apply on open days");
  check("a taken slot is refused", (await book(bea, prenatal(WED, "09:00"))).status === 409);
  check("a time past closing is refused", (await book(bea, prenatal(WED, "16:00"))).status === 400);
  check("a lunch-break time is refused", (await book(bea, prenatal(WED, "12:20"))).status === 400);
  check("a second prenatal visit the same day is refused", (await book(alice, prenatal(WED, "10:00"))).body.code === "DUPLICATE_BOOKING");

  console.log("\nRescheduling follows the same rule");
  const move = (body) => request(`/appointments/${stored._id}/reschedule`, { method: "PATCH", token: alice.token, body });
  const toThursday = await move({ appointmentDate: THU, slotStart: iso(localAt(THU, "10:00")) });
  check("moving to a Thursday is refused with the reason", toThursday.status === 400 && toThursday.body.message === THURSDAY_MESSAGE, `${toThursday.status} ${toThursday.body.message}`);
  const moveOptions = await request(`/appointments/${stored._id}/reschedule-options?date=${THU}`, { token: alice.token });
  check("reschedule options show Thursday closed", moveOptions.status === 200 && moveOptions.body.day.status === "closed");
  const moved = await move({ appointmentDate: FRI, slotStart: iso(localAt(FRI, "13:20")) });
  check("moving to an open Friday slot works", moved.status === 200 && moved.body.appointment.status === "rescheduled", `${moved.status} ${moved.body.message}`);

  console.log("\nMissions no longer carry prenatal");
  const mission = await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: THU, categories: [{ categoryKey: "prenatal", durationMinutes: 20 }] } });
  check("a mission can no longer list prenatal", mission.status === 400 && /own schedule/.test(mission.body.message));

  console.log("\nAn older Thursday prenatal visit stays readable and unchanged");
  const oldMission = await MissionSchedule.collection.insertOne({ date: localAt(THU, "00:00"), categories: [{ categoryKey: "prenatal", durationMinutes: 20 }], createdBy: doctor.user._id, morningStart: "08:00", morningEnd: "12:00", afternoonStart: "13:00", afternoonEnd: "17:00" });
  const legacy = await Appointment.create({ resident: bea.user._id, consultationType: "prenatal", description: "Older mission visit", status: "confirmed", ageTier: 4, prioritySortKey: 4, missionSchedule: oldMission.insertedId, slotStart: localAt(THU, "08:00"), slotEnd: localAt(THU, "08:20") });
  const mine = (await request("/appointments/me", { token: bea.token })).body.appointments ?? [];
  check("the resident still sees it confirmed at its time", mine.some((a) => String(a._id) === String(legacy._id) && a.status === "confirmed" && iso(a.slotStart) === iso(localAt(THU, "08:00"))));
  const legacyMove = await request(`/appointments/${legacy._id}/reschedule`, { method: "PATCH", token: bea.token, body: { appointmentDate: THU, slotStart: iso(localAt(THU, "09:00")) } });
  check("it cannot be moved to another Thursday time", legacyMove.status === 400);
  const kept = await Appointment.findById(legacy._id).lean();
  check("it is not changed or cancelled", kept.status === "confirmed" && iso(kept.slotStart) === iso(localAt(THU, "08:00")));
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
