"use strict";

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish, DAY_MS } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const Notification = require("../../models/Notification");

const iso = (date) => new Date(date).toISOString();
const ACTIVE = ["confirmed", "rescheduled", "processing"];
let keyCount = 0;
const newKey = () => `imm-test-${Date.now().toString(36)}-${(keyCount += 1)}`;

/** Holds every insert back so all racers read the day before any of them writes. */
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
  const midwife = await createUser("midwife");
  const parents = [];
  for (let i = 0; i < 8; i += 1) parents.push(await createUser("resident"));
  const [ana, ben, cai, dee, eve] = parents;

  const wed1 = upcomingDateKey(3);
  const wed2 = upcomingDateKey(3, 1);
  const shot = (who, body) => request("/appointments", { method: "POST", token: who.token, body });
  const child = (extra = {}) => ({
    consultationType: "immunization",
    childName: "Test Child One",
    childDateOfBirth: "2025-03-14",
    appointmentDate: wed1,
    requestKey: newKey(),
    ...extra,
  });
  const onDay = (key) =>
    Appointment.find({ consultationType: "immunization", status: { $in: ACTIVE }, slotStart: { $gte: localAt(key, "00:00"), $lt: localAt(key, "23:59") } })
      .sort({ slotStart: 1 })
      .lean();

  console.log("\nScenario A: no medical mission exists at all");
  check("there is no mission", (await MissionSchedule.countDocuments()) === 0);
  const options = await request("/appointments/booking-options?consultationType=immunization", { token: ana.token });
  const days = options.body.days ?? [];
  check(
    "booking options list the next Wednesdays on their own schedule",
    options.status === 200 && options.body.scheduling === "weekly" && days.length >= 7 && days.length <= 8 &&
      days.every((d) => new Date(d.date).getDay() === 3) && days[0].totalPositions === 24 && options.body.intervalMinutes === 10,
    JSON.stringify({ status: options.status, n: days.length, first: days[0] })
  );
  check("the first Wednesday's next time is 8:00 AM", days.find((d) => d.dateKey === wed1)?.nextStart === iso(localAt(wed1, "08:00")));

  console.log("\nFirst come, first served, 10 minutes apart, assigned by the server");
  const a = await shot(ana, child({ childName: "Ana Child" }));
  const b = await shot(ben, child({ childName: "Ben Child", slotStart: iso(localAt(wed1, "11:00")), missionScheduleId: "507f1f77bcf86cd799439011" }));
  const c = await shot(cai, child({ childName: "Cai Child", description: "should not be stored", additionalNotes: "nor this" }));
  check("all three are created and confirmed", [a, b, c].every((r) => r.status === 201 && r.body.appointment?.status === "confirmed"), [a, b, c].map((r) => `${r.status} ${r.body.message}`).join(" | "));
  check(
    "A gets 8:00, B 8:10, C 8:20, in booking order",
    [a, b, c].map((r) => r.body.appointment?.slotStart).join() === ["08:00", "08:10", "08:20"].map((t) => iso(localAt(wed1, t))).join()
  );
  check("a time sent by the client is ignored", b.body.appointment?.slotStart === iso(localAt(wed1, "08:10")));
  const stored = await Appointment.findById(c.body.appointment?._id).lean();
  check(
    "each visit lasts exactly 10 minutes",
    [a, b, c].every((r) => new Date(r.body.appointment.slotEnd) - new Date(r.body.appointment.slotStart) === 10 * 60000)
  );
  check(
    "the child is stored, and no reason, notes, or mission",
    stored.childName === "Cai Child" && iso(stored.childDateOfBirth) === iso(new Date(2025, 2, 14)) &&
      stored.description === "" && stored.additionalNotes === "" && stored.missionSchedule === null
  );
  check("the existing confirmation notice is sent", Boolean(await Notification.findOne({ recipient: cai.user._id, type: "appointment_confirmed", body: /first come, first served/ })));

  console.log("\nValidation");
  const refused = async (label, body, status = 400) => {
    const res = await shot(dee, child(body));
    check(label, res.status === status, `${res.status} ${res.body.message}`);
  };
  await refused("a missing child name is refused", { childName: "   " });
  await refused("a child name with digits is refused", { childName: "Child 123" });
  await refused("a missing date of birth is refused", { childDateOfBirth: "" });
  await refused("an impossible date of birth is refused", { childDateOfBirth: "2025-02-30" });
  const tomorrow = new Date(Date.now() + DAY_MS);
  await refused("a future date of birth is refused", { childDateOfBirth: tomorrow.toISOString().slice(0, 10) });
  for (const weekday of [0, 1, 2, 4, 5, 6]) {
    const res = await shot(dee, child({ appointmentDate: upcomingDateKey(weekday) }));
    check(`a ${["Sunday", "Monday", "Tuesday", "", "Thursday", "Friday", "Saturday"][weekday]} is refused`, res.status === 400 && /Wednesdays/.test(res.body.message), res.body.message);
  }
  await refused("a Wednesday past the 8-week window is refused", { appointmentDate: upcomingDateKey(3, 9) });
  await refused("a past Wednesday is refused", { appointmentDate: upcomingDateKey(3, -2) });
  await refused("a missing appointment date is refused", { appointmentDate: undefined });
  check("no refused attempt created anything", (await Appointment.countDocuments({ resident: dee.user._id })) === 0);
  const staffBooking = await shot(midwife, child());
  check("staff cannot book as a resident", staffBooking.status === 403);

  console.log("\nConcurrent and repeated submissions");
  const racers = parents.slice(3, 8);
  const race = await withSlowInserts(() => Promise.all(racers.map((who, i) => shot(who, child({ childName: `Racer Child ${"ABCDE"[i]}`, appointmentDate: wed2 })))));
  const raceStarts = race.map((r) => r.body.appointment?.slotStart).sort();
  check("five simultaneous bookings all succeed", race.every((r) => r.status === 201), race.map((r) => r.status).join());
  check(
    "they get five different positions, 8:00 to 8:40, none shared",
    new Set(raceStarts).size === 5 && raceStarts.join() === ["08:00", "08:10", "08:20", "08:30", "08:40"].map((t) => iso(localAt(wed2, t))).join(),
    raceStarts.join()
  );
  const racedRows = await Appointment.find({ _id: { $in: race.map((r) => r.body.appointment?._id) } }).lean();
  const byCommit = [...racedRows].sort((x, y) => x.createdAt - y.createdAt).map((r) => iso(r.slotStart));
  check("positions follow the server's commit order, not the client's clock", byCommit.join() === [...byCommit].sort().join(), byCommit.join());

  // Resident A sends at t, resident B 50 ms later, both while the other is still in flight.
  const wed3 = upcomingDateKey(3, 2);
  const first = shot(parents[3], child({ childName: "Early Child", appointmentDate: wed3 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = shot(parents[4], child({ childName: "Later Child", appointmentDate: wed3 }));
  const [early, later] = await Promise.all([first, second]);
  check(
    "A request that reaches the server first gets 8:00, the next one 8:10",
    early.body.appointment?.slotStart === iso(localAt(wed3, "08:00")) && later.body.appointment?.slotStart === iso(localAt(wed3, "08:10")),
    `${early.body.appointment?.slotStart} ${later.body.appointment?.slotStart}`
  );

  const tapBody = child({ childName: "Tap Child", appointmentDate: wed2 });
  const taps = await withSlowInserts(() => Promise.all([shot(eve, tapBody), shot(eve, tapBody)]));
  const retry = await shot(eve, tapBody);
  const eveRows = await Appointment.find({ resident: eve.user._id, childName: "Tap Child" }).lean();
  check("a double tap and a retry create one appointment", eveRows.length === 1 && [...taps, retry].every((r) => String(r.body.appointment?._id) === String(eveRows[0]._id)), `${eveRows.length}`);
  const sameChild = await shot(eve, { ...tapBody, requestKey: newKey(), childName: "tap child" });
  check("the same child on the same Wednesday is refused", sameChild.status === 409 && sameChild.body.code === "DUPLICATE_BOOKING");
  check("the refusal never names the child", !/tap child/i.test(sameChild.body.message));
  const sibling = await shot(eve, { ...tapBody, requestKey: newKey(), childName: "Tap Sibling" });
  check("a sibling on the same Wednesday is allowed", sibling.status === 201);

  console.log("\nCancelling releases the position");
  const cancel = await request(`/appointments/${b.body.appointment._id}/cancel`, { method: "PATCH", token: ben.token, body: {} });
  const cancelled = await Appointment.findById(b.body.appointment._id).lean();
  check("the cancelled visit stays on record and holds no position", cancel.status === 200 && cancelled.status === "cancelled" && cancelled.slotStart === null && cancelled.immunizationSlotKey === null);
  const d = await shot(dee, child({ childName: "Dee Child" }));
  check("the next booking takes the freed 8:10 position", d.status === 201 && d.body.appointment.slotStart === iso(localAt(wed1, "08:10")), d.body.appointment?.slotStart);
  check("no two active visits share a time", new Set((await onDay(wed1)).map((r) => iso(r.slotStart))).size === (await onDay(wed1)).length);

  console.log("\nRescheduling takes the first open position on the new Wednesday");
  const resOptions = await request(`/appointments/${a.body.appointment._id}/reschedule-options`, { token: ana.token });
  check("reschedule options are weekly days, not missions", resOptions.body.scheduling === "weekly" && resOptions.body.assignsEarliestSlot === true && (resOptions.body.days ?? []).length > 0);
  const moved = await request(`/appointments/${a.body.appointment._id}/reschedule`, {
    method: "PATCH",
    token: ana.token,
    body: { appointmentDate: wed2, slotStart: iso(localAt(wed2, "11:30")) },
  });
  // Racers hold 8:00 to 8:40, the tap child 8:50 and the sibling 9:00, so the options say 9:10.
  const nextAfterRace = resOptions.body.days.find((day) => day.dateKey === wed2)?.nextStart;
  check("the options show that next time as 9:10 AM", nextAfterRace === iso(localAt(wed2, "09:10")), nextAfterRace);
  check("A moves to the next open time on the new day, not the one sent", moved.status === 200 && moved.body.appointment.status === "rescheduled" && moved.body.appointment.slotStart === nextAfterRace, `${moved.status} ${moved.body.appointment?.slotStart} ${moved.body.message}`);
  check("A's old 8:00 position is free again", (await onDay(wed1)).every((r) => iso(r.slotStart) !== iso(localAt(wed1, "08:00"))));
  const tuesday = await request(`/appointments/${a.body.appointment._id}/reschedule`, { method: "PATCH", token: ana.token, body: { appointmentDate: upcomingDateKey(2, 1) } });
  check("rescheduling to a Tuesday is refused", tuesday.status === 400);
  const other = await request(`/appointments/${a.body.appointment._id}/reschedule`, { method: "PATCH", token: ben.token, body: { appointmentDate: wed1 } });
  check("another resident cannot move it", other.status === 403);

  console.log("\nScenarios B to D: missions exist, are edited, and are deleted");
  const mission = await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: wed1, categories: [{ categoryKey: "prenatal", durationMinutes: 20 }, { categoryKey: "bp_checking", durationMinutes: 5 }] } });
  const withImm = await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: wed2, categories: [{ categoryKey: "immunization", durationMinutes: 10 }] } });
  check("a mission can no longer offer immunization", mission.status === 201 && withImm.status === 400 && /own schedule/.test(withImm.body.message), withImm.body.message);
  const missionSlots = await request(`/mission-schedule/${mission.body.missionSchedule._id}/available-slots?categoryKey=immunization`, { token: midwife.token });
  check("missions refuse to list immunization slots", missionSlots.status === 400);
  const beforeEdit = (await onDay(wed1)).map((r) => `${r._id}@${iso(r.slotStart)}`).join();
  const edited = await request(`/mission-schedule/${mission.body.missionSchedule._id}`, { method: "PATCH", token: doctor.token, body: { date: wed1, startTime: "13:00", endTime: "15:00", categories: [{ categoryKey: "bp_checking", durationMinutes: 5 }] } });
  check("editing the Wednesday mission leaves every immunization in place", edited.status === 200 && (await onDay(wed1)).map((r) => `${r._id}@${iso(r.slotStart)}`).join() === beforeEdit);
  const removed = await request(`/mission-schedule/${mission.body.missionSchedule._id}`, { method: "DELETE", token: doctor.token });
  check("deleting it leaves them in place too", removed.status === 200 && (await onDay(wed1)).map((r) => `${r._id}@${iso(r.slotStart)}`).join() === beforeEdit);
  const afterDelete = await shot(ana, child({ childName: "Ana Second Child" }));
  check("immunization stays bookable after the mission is gone", afterDelete.status === 201);

  console.log("\nStaff views and actions");
  const queue = (await request("/appointments?status=confirmed&categoryKey=immunization", { token: midwife.token })).body.appointments ?? [];
  check("the midwife sees immunization with the child's name and birth date", queue.some((row) => row.childName === "Cai Child" && row.childDateOfBirth));
  const reassign = await request(`/appointments/${c.body.appointment._id}/reassign`, {
    method: "PATCH",
    token: midwife.token,
    body: { missionScheduleId: String(withImm.body?.missionSchedule?._id ?? mission.body.missionSchedule._id), categoryKey: "prenatal", slotStart: iso(localAt(wed1, "09:00")) },
  });
  check("staff cannot move an immunization onto a mission", reassign.status === 400, `${reassign.status}`);
  const legacy = await Appointment.create({ resident: dee.user._id, consultationType: "immunization", ageTier: 4, prioritySortKey: 4, statusHistory: [{ status: "pending", timestamp: new Date() }] });
  const placed = await request(`/appointments/${legacy._id}/assign`, { method: "PATCH", token: midwife.token, body: {} });
  check("staff place an older pending request on the first open Wednesday position", placed.status === 200 && placed.body.appointment.status === "confirmed" && placed.body.appointment.missionSchedule === null, `${placed.status} ${placed.body.message}`);
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
