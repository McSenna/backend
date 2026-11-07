"use strict";

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish, DAY_MS } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const Notification = require("../../models/Notification");

// A mission service with resident-chosen reschedules; prenatal left missions on 2026-11-07.
const PRENATAL = { categoryKey: "consultation", durationMinutes: 20 };
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

  const aShot=await placedShot(residentA,localAt(w1Key,"08:00"));
  const bShot=await placedShot(residentB,localAt(w2Key,"09:00"));
  const reschedule=(who,id,body)=>request(`/appointments/${id}/reschedule`,{method:"PATCH",token:who.token,body});
  const options=await request(`/appointments/${bShot._id}/reschedule-options`,{token:residentB.token});
  check("resident cannot choose a replacement immunization date",options.status===400);
  const moved=await reschedule(residentB,bShot._id,{appointmentDate:w1Key,slotStart:iso(localAt(w1Key,"09:00"))});
  const stored=await Appointment.findById(bShot._id).lean();
  check("resident changes cannot move the assigned visit or create priority",moved.status===400 && stored.status==="confirmed" && iso(stored.slotStart)===iso(localAt(w2Key,"09:00")) && stored.reschedulePriorityAt===null);
  check("the other patient's original slot is preserved",iso((await Appointment.findById(aShot._id).lean()).slotStart)===iso(localAt(w1Key,"08:00")));
  check("refused changes send no reschedule notice",await Notification.countDocuments({recipient:residentB.user._id,type:"appointment_rescheduled"})===0);

  console.log("\nOther services keep the resident's choice of time");
  const mission = (await request("/mission-schedule", { method: "POST", token: doctor.token, body: { date: w1Key, categories: [PRENATAL] } })).body.missionSchedule;
  const prenatal = await Appointment.create({
    resident: residentC.user._id, consultationType: "consultation", status: "confirmed", ageTier: 6, prioritySortKey: 6,
    missionSchedule: mission._id, assignedCategoryKey: "consultation", assignedDurationMinutes: 20,
    slotStart: localAt(w1Key, "11:00"), slotEnd: localAt(w1Key, "11:20"), approvedAt: new Date(),
    statusHistory: [{ status: "confirmed", timestamp: new Date() }],
  });
  const prenatalOptions = (await request(`/appointments/${prenatal._id}/reschedule-options`, { token: residentC.token })).body;
  check("consultation options are mission times, not first-slot", prenatalOptions.assignsEarliestSlot === false && prenatalOptions.scheduling === "mission");
  const prenatalMove = await reschedule(residentC, prenatal._id, { missionScheduleId: String(mission._id), slotStart: iso(localAt(w1Key, "14:00")) });
  const prenatalStored = await Appointment.findById(prenatal._id).lean();
  check(
    "a consultation can move to a chosen afternoon time without priority",
    prenatalMove.status === 200 && iso(prenatalStored.slotStart) === iso(localAt(w1Key, "14:00")) && prenatalStored.reschedulePriorityAt === null
  );

  console.log("\nA full Thursday and the Complete gate");
  const fullKey = upcomingDateKey(4, 2);
  for (let i = 0; i < 24; i += 1) await placedShot(residentC, new Date(localAt(fullKey, "08:00").getTime() + i * 600000), { childName: `Full Child ${i}` });
  const full = await reschedule(residentB, bShot._id, { appointmentDate: fullKey });
  check("mother cannot choose even a full Thursday", full.status === 400 && full.body.message.includes("assigned by the system"), full.body.message);
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
  check("placing the first in line works and uses the weekly schedule", inOrder.status === 200 && inOrder.body.appointment.missionSchedule === null && inOrder.body.appointment.slotStart === iso(localAt(w1Key, "08:10")), `${inOrder.status} ${inOrder.body.appointment?.slotStart}`);
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
