"use strict";

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish, DAY_MS } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const Notification = require("../../models/Notification");

const PRENATAL = { categoryKey: "prenatal", durationMinutes: 20 };
const iso = (date) => new Date(date).toISOString();

/** A visit already holding a weekly position, written directly so its day can be chosen freely. */
const placedShot = (resident, slotStart, extra = {}) =>
  Appointment.create({
    resident: resident.user._id,
    consultationType: "immunization",
    childName: "Test Child",
    childDateOfBirth: new Date(2025, 0, 10),
    status: "confirmed",
    ageTier: 0,
    prioritySortKey: 0,
    assignedCategoryKey: "immunization",
    assignedDurationMinutes: 10,
    slotStart,
    slotEnd: new Date(slotStart.getTime() + 10 * 60000),
    immunizationSlotKey: slotStart.toISOString(),
    approvedAt: new Date(),
    statusHistory: [{ status: "confirmed", timestamp: new Date() }],
    ...extra,
  });

const overlaps = (rows) =>
  rows.some((a, i) => rows.some((b, j) => i < j && a.slotStart < b.slotEnd && b.slotStart < a.slotEnd));

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const [residentA, residentB, residentC] = [await createUser("resident"), await createUser("resident"), await createUser("resident")];
  const w1Key = upcomingDateKey(4);
  const w2Key = upcomingDateKey(4, 1);

  console.log("\nA new immunization booking stays a normal appointment");
  const aBooked = await request("/appointments", {
    method: "POST",
    token: residentA.token,
    body: { consultationType: "immunization", childName: "Child A", childDateOfBirth: "2025-02-01", appointmentDate: w1Key, requestKey: "priority-test-booking-a" },
  });
  const aShot = await Appointment.findById(aBooked.body.appointment?._id).lean();
  check(
    "it is confirmed on the first Thursday at 08:00 with no reschedule priority",
    aShot?.status === "confirmed" && iso(aShot.slotStart) === iso(localAt(w1Key, "08:00")) && aShot.reschedulePriorityAt === null,
    JSON.stringify({ status: aShot?.status, slotStart: aShot?.slotStart })
  );

  console.log("\nRescheduling an immunization takes the first open position");
  const bShot = await placedShot(residentB, localAt(w2Key, "09:00"));
  const options = (await request(`/appointments/${bShot._id}/reschedule-options`, { token: residentB.token })).body;
  const w1Option = options.days.find((d) => d.dateKey === w1Key);
  check("the options tell the app the time is assigned, not chosen", options.assignsEarliestSlot === true && options.scheduling === "weekly");
  check("08:00 is taken, so 08:10 is shown as the next time", w1Option?.nextStart === iso(localAt(w1Key, "08:10")));

  const reschedule = (who, id, body) => request(`/appointments/${id}/reschedule`, { method: "PATCH", token: who.token, body });
  const moved = await reschedule(residentB, bShot._id, { appointmentDate: w1Key, slotStart: iso(localAt(w1Key, "09:00")) });
  const stored = await Appointment.findById(bShot._id).lean();
  check(
    "a hand-edited later time is ignored: the same record moves to 08:10, rescheduled with priority",
    moved.status === 200 && stored.status === "rescheduled" && iso(stored.slotStart) === iso(localAt(w1Key, "08:10")) && stored.reschedulePriorityAt instanceof Date,
    `${moved.status} ${moved.body.message}`
  );
  const onTuesday = await reschedule(residentB, bShot._id, { appointmentDate: upcomingDateKey(2, 1) });
  check("a Tuesday is still refused", onTuesday.status === 400 && onTuesday.body.message.includes("Thursdays"));
  check("no second appointment was created", (await Appointment.countDocuments({ resident: residentB.user._id })) === 1);
  check("the patient already at 08:00 keeps that slot", iso((await Appointment.findById(aShot._id).lean()).slotStart) === iso(localAt(w1Key, "08:00")));
  const onW1 = await Appointment.find({ consultationType: "immunization", status: { $in: ["confirmed", "rescheduled"] }, slotStart: { $gte: localAt(w1Key, "00:00"), $lt: localAt(w2Key, "00:00") } }).lean();
  check("nothing on that Thursday overlaps", !overlaps(onW1));
  check("the existing reschedule notification names the new time", Boolean(await Notification.findOne({ recipient: residentB.user._id, type: "appointment_rescheduled", body: /8:10/ })));

  console.log("\nOther services keep the resident's choice of time");
  const mission = (await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: w1Key, categories: [PRENATAL] } })).body.missionSchedule;
  const prenatal = await Appointment.create({
    resident: residentC.user._id, consultationType: "prenatal", status: "confirmed", ageTier: 4, prioritySortKey: 4,
    missionSchedule: mission._id, assignedCategoryKey: "prenatal", assignedDurationMinutes: 20,
    slotStart: localAt(w1Key, "11:00"), slotEnd: localAt(w1Key, "11:20"), approvedAt: new Date(),
    statusHistory: [{ status: "confirmed", timestamp: new Date() }],
  });
  const prenatalOptions = (await request(`/appointments/${prenatal._id}/reschedule-options`, { token: residentC.token })).body;
  check("prenatal options are mission times, not first-slot", prenatalOptions.assignsEarliestSlot === false && prenatalOptions.scheduling === "mission");
  const prenatalMove = await reschedule(residentC, prenatal._id, { missionScheduleId: String(mission._id), slotStart: iso(localAt(w1Key, "14:00")) });
  const prenatalStored = await Appointment.findById(prenatal._id).lean();
  check(
    "a prenatal visit can move to a chosen afternoon time without priority",
    prenatalMove.status === 200 && iso(prenatalStored.slotStart) === iso(localAt(w1Key, "14:00")) && prenatalStored.reschedulePriorityAt === null
  );

  console.log("\nA full Thursday and the Complete gate");
  const fullKey = upcomingDateKey(4, 2);
  for (let i = 0; i < 24; i += 1) await placedShot(residentC, new Date(localAt(fullKey, "08:00").getTime() + i * 600000), { childName: `Full Child ${i}` });
  const full = await reschedule(residentB, bShot._id, { appointmentDate: fullKey });
  check("a Thursday with no open position is refused", full.status === 409 && full.body.message.includes("choose another Thursday"), full.body.message);
  const early = await request(`/appointments/${bShot._id}/complete`, {
    method: "POST",
    token: midwife.token,
    body: { medicalRecord: { assessment: "Dose given.", serviceDetails: { vaccineName: "Test vaccine", doseNumber: 1 } } },
  });
  check("priority does not open Complete before the scheduled Thursday", early.status === 409, `${early.status}`);

  console.log("\nStaff see and must follow the same pending order");
  const infant = await createUser("resident", new Date(Date.now() - 200 * DAY_MS).toISOString().slice(0, 10));
  const pendingRow = (resident, extra) => Appointment.create({ resident: resident.user._id, consultationType: "immunization", ageTier: 4, prioritySortKey: 4, ...extra });
  const infantRequest = await pendingRow(infant, {});
  const rescheduledRequest = await pendingRow(residentC, { reschedulePriorityAt: new Date() });
  const order = (await request("/appointments?status=pending", { token: midwife.token })).body.appointments.map((a) => String(a._id));
  check(
    "the Pending tab lists the rescheduled request before an infant's new one",
    order.indexOf(String(rescheduledRequest._id)) === 0 && order.indexOf(String(infantRequest._id)) === 1,
    order.join(",")
  );
  const skip = await request(`/appointments/${infantRequest._id}/assign`, { method: "PATCH", token: midwife.token, body: { appointmentDate: w1Key } });
  check("placing the infant first is refused, as the tab order says", skip.status === 409 && skip.body.code === "TRIAGE_ORDER_VIOLATION", `${skip.status}`);
  const inOrder = await request(`/appointments/${rescheduledRequest._id}/assign`, { method: "PATCH", token: midwife.token, body: { appointmentDate: w1Key } });
  check("placing the first in line works and uses the weekly schedule", inOrder.status === 200 && inOrder.body.appointment.missionSchedule === null && inOrder.body.appointment.slotStart === iso(localAt(w1Key, "08:20")), `${inOrder.status} ${inOrder.body.appointment?.slotStart}`);
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
