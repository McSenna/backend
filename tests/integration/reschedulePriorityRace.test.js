"use strict";

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish, DAY_MS } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");

const ACTIVE = ["confirmed", "rescheduled", "processing"];
const iso = (date) => new Date(date).toISOString();

const placed = (resident, slotStart) =>
  Appointment.create({
    resident: resident.user._id,
    consultationType: "immunization",
    childName: "Test Child",
    childDateOfBirth: new Date(2025, 0, 10),
    status: "confirmed",
    ageTier: 4,
    prioritySortKey: 4,
    assignedCategoryKey: "immunization",
    assignedDurationMinutes: 10,
    slotStart,
    slotEnd: new Date(slotStart.getTime() + 10 * 60000),
    immunizationSlotKey: slotStart.toISOString(),
    approvedAt: new Date(),
    statusHistory: [{ status: "confirmed", timestamp: new Date() }],
  });

/** Holds every write back so racing requests all read the day before any of them saves. */
const withSlowWrites = async (work) => {
  const [save, create] = [Appointment.prototype.save, Appointment.create];
  const delay = () => new Promise((resolve) => setTimeout(resolve, 150));
  Appointment.prototype.save = async function delayedSave(...args) {
    await delay();
    return save.apply(this, args);
  };
  Appointment.create = async function delayedCreate(...args) {
    await delay();
    return create.apply(this, args);
  };
  try {
    return await work();
  } finally {
    Appointment.prototype.save = save;
    Appointment.create = create;
  }
};

const overlaps = (rows) =>
  rows.some((a, i) => rows.some((b, j) => i < j && a.slotStart < b.slotEnd && b.slotStart < a.slotEnd));

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const infant = await createUser("resident", new Date(Date.now() - 200 * DAY_MS).toISOString().slice(0, 10));
  const [r1, r2, r3, newcomer] = [await createUser("resident"), await createUser("resident"), await createUser("resident"), await createUser("resident")];

  const w1Key = upcomingDateKey(4);
  const w2Key = upcomingDateKey(4, 1);
  const activeOnW1 = () =>
    Appointment.find({ consultationType: "immunization", status: { $in: ACTIVE }, slotStart: { $gte: localAt(w1Key, "00:00"), $lt: localAt(w2Key, "00:00") } })
      .sort({ slotStart: 1 })
      .lean();
  const book = (who, childName, requestKey) =>
    request("/appointments", {
      method: "POST",
      token: who.token,
      body: { consultationType: "immunization", childName, childDateOfBirth: "2025-01-10", appointmentDate: w1Key, requestKey },
    });
  const reschedule = (who, id) =>
    request(`/appointments/${id}/reschedule`, { method: "PATCH", token: who.token, body: { appointmentDate: w1Key } });

  await placed(infant,localAt(w1Key,"08:00"));
  const [s1, s2, s3] = await Promise.all([r1, r2, r3].map((r, i) => placed(r, localAt(w2Key, `09:${i}0`))));

  const race=await withSlowWrites(()=>Promise.all([reschedule(r1,s1._id),reschedule(r2,s2._id)]));
  check("concurrent resident date changes are both refused",race.every(result=>result.status===400));
  const [won,lost]=await Appointment.find({_id:{$in:[s1._id,s2._id]}}).sort({slotStart:1}).lean();
  check("original assigned appointments retain their times",iso(won.slotStart)===iso(localAt(w2Key,"09:00")) && iso(lost.slotStart)===iso(localAt(w2Key,"09:10")));
  const [booked,moved]=await withSlowWrites(()=>Promise.all([book(newcomer,"Newcomer Child","race-test-newcomer-1"),reschedule(r3,s3._id)]));
  const afterRace=await activeOnW1();
  check("a manual booking racing a manual move cannot bypass automatic assignment",booked.status===400 && moved.status===400 && afterRace.length===1 && !overlaps(afterRace));

  console.log("\nA mission edit or delete no longer moves anyone");
  const mission = await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: w1Key, categories: [{ categoryKey: "consultation", durationMinutes: 20 }] } });
  const before = afterRace.map((a) => `${a._id}@${iso(a.slotStart)}`).join();
  const edit = await request(`/mission-schedule/${mission.body.missionSchedule._id}`, {
    method: "PATCH",
    token: doctor.token,
    body: { date: w1Key, startTime: "09:00", endTime: "12:00", categories: [{ categoryKey: "consultation", durationMinutes: 20 }] },
  });
  check("the edit leaves every immunization where it was", edit.status === 200 && (await activeOnW1()).map((a) => `${a._id}@${iso(a.slotStart)}`).join() === before);
  await request(`/mission-schedule/${mission.body.missionSchedule._id}`, { method: "DELETE", token: doctor.token });
  check("so does deleting the mission", (await activeOnW1()).map((a) => `${a._id}@${iso(a.slotStart)}`).join() === before);

  console.log("\nCancelling a rescheduled appointment");
  const firstMoved = String(won._id);
  const ownerOf = (row) => [r1, r2].find((r) => String(r.user._id) === String(row.resident));
  const cancel = await request(`/appointments/${firstMoved}/cancel`, { method: "PATCH", token: ownerOf(won).token, body: {} });
  const lists = await Promise.all(
    [...ACTIVE.map((status) => `/appointments?status=${status}`), "/appointments/pending"].map((path) => request(path, { token: midwife.token }))
  );
  const listed = lists.flatMap((res) => res.body.appointments ?? []).map((a) => String(a._id));
  check("it leaves the active and pending queues", cancel.status === 200 && !listed.includes(firstMoved));
  check("it stays on record as cancelled", (await Appointment.findById(firstMoved).lean())?.status === "cancelled");
  const options=await request(`/appointments/${lost._id}/reschedule-options`,{token:ownerOf(lost).token});
  check("cancellation does not reopen a mother date picker",options.status===400);
  check("cancelled legacy visit releases its slot",(await Appointment.findById(firstMoved).lean()).immunizationSlotKey===null);

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
