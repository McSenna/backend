"use strict";

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");

const THURSDAY = 4;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const IMMUNIZATION = { categoryKey: "immunization", durationMinutes: 10 };
const BP = { categoryKey: "bp_checking", durationMinutes: 5 };
const PRENATAL = { categoryKey: "prenatal", durationMinutes: 20 };
const DAY_ERROR = "Immunization appointments are only available on Thursdays.";
const OWN_SCHEDULE = /own schedule/;

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const residentA = await createUser("resident", "1988-03-02");
  const residentB = await createUser("resident", "1992-07-21");
  const createMission = (date, categories) =>
    request("/mission-schedule", { method: "POST", token: doctor.token, body: { date, categories } });

  console.log("\nMissions never carry immunization");
  for (const weekday of [4, 0, 1, 2, 3, 5, 6]) {
    const res = await createMission(upcomingDateKey(weekday, 2), [IMMUNIZATION, BP]);
    check(`a ${WEEKDAY_NAMES[weekday]} mission offering immunization is rejected`, res.status === 400 && OWN_SCHEDULE.test(res.body.message), `${res.status} ${res.body.message}`);
  }
  const tuesday = await createMission(upcomingDateKey(2, 2), [PRENATAL, BP]);
  check("a mission without immunization is still created", tuesday.status === 201);
  const addShot = await request(`/mission-schedule/${tuesday.body.missionSchedule._id}`, {
    method: "PATCH",
    token: doctor.token,
    body: { categories: [PRENATAL, IMMUNIZATION] },
  });
  check("adding immunization to an existing mission is rejected", addShot.status === 400 && OWN_SCHEDULE.test(addShot.body.message));

  // A mission saved before this change: a Tuesday that still lists immunization.
  const firstThursday = upcomingDateKey(THURSDAY);
  const legacyDay = localAt(upcomingDateKey(2), "00:00");
  const legacy = await MissionSchedule.create({ date: legacyDay, categories: [IMMUNIZATION, BP], createdBy: doctor.user._id });
  const legacySlot = new Date(legacyDay.getTime() + 9 * 60 * 60 * 1000).toISOString();

  console.log("\nResident booking on the weekly schedule");
  const book = (who, body) => request("/appointments", { method: "POST", token: who.token, body });
  const shotOptions = (await request("/appointments/booking-options?consultationType=immunization", { token: residentA.token })).body;
  check(
    "immunization options are Thursdays only, never the old Tuesday mission",
    shotOptions.days.length > 0 && shotOptions.days.every((d) => new Date(d.date).getDay() === THURSDAY) && !JSON.stringify(shotOptions).includes(String(legacy._id))
  );
  const shotBody = { consultationType: "immunization", childName: "Test Child", childDateOfBirth: "2024-05-01" };
  const onTuesday = await book(residentA, { ...shotBody, appointmentDate: upcomingDateKey(2), requestKey: "service-day-a-tue" });
  check("booking immunization on a Tuesday is rejected", onTuesday.status === 400 && onTuesday.body.message === DAY_ERROR, onTuesday.body.message);
  const forced = await book(residentA, { ...shotBody, appointmentDate: firstThursday, missionScheduleId: String(legacy._id), slotStart: legacySlot, requestKey: "service-day-a-shot" });
  check(
    "a booking that names the old mission and time still lands on the Thursday schedule",
    forced.status === 201 && forced.body.appointment.missionSchedule === null && new Date(forced.body.appointment.slotStart).getDay() === THURSDAY,
    `${forced.status} ${forced.body.message}`
  );

  const bpOptions = (await request("/appointments/booking-options?consultationType=bp_checking", { token: residentA.token })).body;
  const bpLegacy = bpOptions.schedules.find((s) => s.missionScheduleId === String(legacy._id));
  check("BP checking is still offered on the old Tuesday mission", Boolean(bpLegacy?.availableSlotStarts.length));
  const bp = await book(residentA, { consultationType: "bp_checking", description: "Monthly reading", missionScheduleId: String(legacy._id), slotStart: bpLegacy.availableSlotStarts[0], requestKey: "service-day-a-bp" });
  check("BP checking still books on that mission", bp.status === 201 && String(bp.body.appointment.missionSchedule?._id) === String(legacy._id));

  console.log("\nResident reschedule");
  const shot = forced.body.appointment;
  const options = await request(`/appointments/${shot._id}/reschedule-options`, { token: residentA.token });
  check("only Thursdays are offered", options.status === 200 && options.body.days.every((d) => new Date(d.date).getDay() === THURSDAY));
  const reschedule = (who, body) => request(`/appointments/${shot._id}/reschedule`, { method: "PATCH", token: who.token, body });
  const toTuesday = await reschedule(residentA, { appointmentDate: upcomingDateKey(2, 1) });
  check("Thursday to Tuesday is rejected", toTuesday.status === 400 && toTuesday.body.message === DAY_ERROR, toTuesday.body.message);
  const past = await reschedule(residentA, { appointmentDate: upcomingDateKey(THURSDAY, -1) });
  check("a past Thursday is rejected", past.status === 400, `${past.status}`);
  const other = await reschedule(residentB, { appointmentDate: upcomingDateKey(THURSDAY, 1) });
  check("another resident cannot reschedule it", other.status === 403, `${other.status}`);
  check("another resident cannot read its options", (await request(`/appointments/${shot._id}/reschedule-options`, { token: residentB.token })).status === 403);
  const toNext = await reschedule(residentA, { appointmentDate: upcomingDateKey(THURSDAY, 1) });
  check(
    "Thursday to the next Thursday is accepted on the same record",
    toNext.status === 200 && toNext.body.appointment.status === "rescheduled" && String(toNext.body.appointment._id) === String(shot._id) &&
      (await Appointment.countDocuments({ resident: residentA.user._id })) === 2,
    `${toNext.status} ${toNext.body.message}`
  );
  check("the moved visit keeps the 10-minute length", new Date(toNext.body.appointment.slotEnd) - new Date(toNext.body.appointment.slotStart) === 10 * 60 * 1000);

  console.log("\nStaff scheduling paths");
  const legacySlots = await request(`/mission-schedule/${legacy._id}/available-slots?categoryKey=immunization`, { token: midwife.token });
  check("the staff slot list refuses immunization on any mission", legacySlots.status === 400 && OWN_SCHEDULE.test(legacySlots.body.message));
  const suggest = await request(`/appointments/suggest-slot?missionScheduleId=${legacy._id}&categoryKey=immunization`, { token: midwife.token });
  check("the slot suggestion refuses immunization", suggest.status === 400);
  const bpSlots = await request(`/mission-schedule/${legacy._id}/available-slots?categoryKey=bp_checking`, { token: midwife.token });
  check("BP checking slots on that Tuesday still load", bpSlots.status === 200 && bpSlots.body.availableSlotStarts.length > 0);
  const reassign = await request(`/appointments/${shot._id}/reassign`, {
    method: "PATCH",
    token: midwife.token,
    body: { missionScheduleId: String(legacy._id), categoryKey: "immunization", slotStart: legacySlot },
  });
  check("staff cannot move immunization onto a mission", reassign.status === 400 && OWN_SCHEDULE.test(reassign.body.message));
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
