"use strict";

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");

const THURSDAY = 4;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const IMMUNIZATION = { categoryKey: "immunization", durationMinutes: 10 };
const BP = { categoryKey: "bp_checking", durationMinutes: 5 };
const PRENATAL = { categoryKey: "prenatal", durationMinutes: 20 };
const SYSTEM_ASSIGNED = /assigned automatically|assigned by the system/;
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
  const tuesday = await createMission(upcomingDateKey(2, 2), [PRENATAL]);
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
  const shotOptions = await request("/appointments/booking-options?consultationType=immunization", { token: residentA.token });
  check("immunization no longer offers mother-selected dates", shotOptions.status===400 && SYSTEM_ASSIGNED.test(shotOptions.body.message));
  const shotBody={consultationType:"immunization",childName:"Test Child",childDateOfBirth:"2024-05-01"};
  for(const appointmentDate of [upcomingDateKey(2),firstThursday]) {
    const attempted=await book(residentA,{...shotBody,appointmentDate,requestKey:"system-assigned-attempt"});
    check("direct resident booking cannot choose any immunization day",attempted.status===400 && SYSTEM_ASSIGNED.test(attempted.body.message));
  }
  const shot=await Appointment.create({resident:residentA.user._id,consultationType:"immunization",childName:"Fictional legacy child",ageTier:0,prioritySortKey:0,status:"confirmed",slotStart:localAt(firstThursday,"08:00"),slotEnd:localAt(firstThursday,"08:10"),immunizationSlotKey:localAt(firstThursday,"08:00").toISOString()});

  // Since 2026-11-06 BP checking has its own Monday to Saturday schedule, so an
  // old mission that still lists it no longer offers or takes BP bookings.
  const legacyTuesday = upcomingDateKey(2);
  const bpOptions = (await request(`/appointments/booking-options?consultationType=bp_checking&date=${legacyTuesday}`, { token: residentA.token })).body;
  check("BP checking lists its own schedule, not the old Tuesday mission", bpOptions.scheduling === "regular" && !bpOptions.schedules && bpOptions.day.slots.length > 0);
  const bp = await book(residentA, { consultationType: "bp_checking", description: "Monthly reading", missionScheduleId: String(legacy._id), appointmentDate: legacyTuesday, slotStart: bpOptions.day.slots[0].start, requestKey: "service-day-a-bp" });
  check("BP checking books that Tuesday on its own schedule, not the mission", bp.status === 201 && bp.body.appointment.missionSchedule == null, `${bp.status} ${bp.body.message}`);

  console.log("\nResident reschedule");
  const options = await request(`/appointments/${shot._id}/reschedule-options`, { token: residentA.token });
  check("mother cannot open a date picker", options.status === 400 && SYSTEM_ASSIGNED.test(options.body.message));
  const reschedule = (who, body) => request(`/appointments/${shot._id}/reschedule`, { method: "PATCH", token: who.token, body });
  const toTuesday = await reschedule(residentA, { appointmentDate: upcomingDateKey(2, 1) });
  check("Thursday to Tuesday is rejected", toTuesday.status === 400 && SYSTEM_ASSIGNED.test(toTuesday.body.message), toTuesday.body.message);
  const past = await reschedule(residentA, { appointmentDate: upcomingDateKey(THURSDAY, -1) });
  check("a past Thursday is rejected", past.status === 400, `${past.status}`);
  const other = await reschedule(residentB, { appointmentDate: upcomingDateKey(THURSDAY, 1) });
  check("another resident cannot reschedule it", other.status === 403, `${other.status}`);
  check("another resident cannot read its options", (await request(`/appointments/${shot._id}/reschedule-options`, { token: residentB.token })).status === 403);
  const toNext = await reschedule(residentA, { appointmentDate: upcomingDateKey(THURSDAY, 1) });
  check("mother cannot move even to another Thursday",toNext.status===400 && SYSTEM_ASSIGNED.test(toNext.body.message));
  const preserved=await Appointment.findById(shot._id).lean();
  check("the legacy assigned time and duration remain unchanged",preserved.slotStart.toISOString()===localAt(firstThursday,"08:00").toISOString() && preserved.slotEnd-preserved.slotStart===600000);

  console.log("\nStaff scheduling paths");
  const legacySlots = await request(`/mission-schedule/${legacy._id}/available-slots?categoryKey=immunization`, { token: midwife.token });
  check("the staff slot list refuses immunization on any mission", legacySlots.status === 400 && OWN_SCHEDULE.test(legacySlots.body.message));
  const suggest = await request(`/appointments/suggest-slot?missionScheduleId=${legacy._id}&categoryKey=immunization`, { token: midwife.token });
  check("the slot suggestion refuses immunization", suggest.status === 400);
  const bpSlots = await request(`/mission-schedule/${legacy._id}/available-slots?categoryKey=bp_checking`, { token: midwife.token });
  check("the staff slot list refuses BP checking on a mission too", bpSlots.status === 400 && OWN_SCHEDULE.test(bpSlots.body.message));
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
