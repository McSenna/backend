"use strict";

const {
  createChecker,
  startHarness,
  createUser,
  upcomingDateKey,
  startOfToday,
  finish,
  DAY_MS,
} = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const Notification = require("../../models/Notification");

const IMMUNIZATION_RECORD = {
  medicalRecord: {
    assessment: "Routine dose given without complications.",
    serviceDetails: { vaccineName: "Test vaccine", doseNumber: 1 },
  },
};
const BP_RECORD = {
  medicalRecord: { assessment: "Reading within range.", serviceDetails: { systolic: 118, diastolic: 76 } },
};

/** A scheduled visit written straight to the database so its day can be chosen freely. */
const scheduledVisit = (resident, consultationType, slotStart, status = "confirmed") =>
  Appointment.create({
    resident: resident.user._id,
    consultationType,
    status,
    ageTier: 4,
    prioritySortKey: 4,
    slotStart,
    slotEnd: new Date(slotStart.getTime() + 10 * 60 * 1000),
    approvedAt: new Date(),
    statusHistory: [{ status, timestamp: new Date() }],
  });

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const bhw = await createUser("bhw");
  const residentA = await createUser("resident", "1985-11-09");
  const residentB = await createUser("resident", "1994-02-17");

  const mission = (
    await request("/mission-schedule", {
      method: "POST",
      token: doctor.token,
      body: {
        date: upcomingDateKey(4),
        categories: [{ categoryKey: "bp_checking", durationMinutes: 5 }],
      },
    })
  ).body.missionSchedule;
  // Immunization books on its own Thursday schedule; BP checking on the mission.
  const shotDay = upcomingDateKey(4);
  await request("/appointments", {
    method: "POST",
    token: residentA.token,
    body: {
      consultationType: "immunization",
      childName: "Test Child",
      childDateOfBirth: "2025-01-10",
      appointmentDate: shotDay,
      requestKey: "actions-test-immunization",
    },
  });
  const { schedules } = (
    await request("/appointments/booking-options?consultationType=bp_checking", { token: residentA.token })
  ).body;
  const [bpStart] = schedules.find((s) => s.missionScheduleId === String(mission._id)).availableSlotStarts;
  await request("/appointments", {
    method: "POST",
    token: residentA.token,
    body: {
      consultationType: "bp_checking",
      description: "Scheduled visit",
      missionScheduleId: String(mission._id),
      slotStart: bpStart,
      requestKey: "actions-test-bp_checking",
    },
  });
  const mine = (await request("/appointments/me", { token: residentA.token })).body.appointments;
  const shot = mine.find((a) => a.consultationType === "immunization");
  const bp = mine.find((a) => a.consultationType === "bp_checking");

  const complete = (id, who, body) => request(`/appointments/${id}/complete`, { method: "POST", token: who.token, body });
  const cancel = (id, who) =>
    request(`/appointments/${id}/cancel`, { method: "PATCH", token: who.token, body: { reason: "Schedule conflict" } });
  const reschedule = (id, who) =>
    request(`/appointments/${id}/reschedule`, {
      method: "PATCH",
      token: who.token,
      body: { appointmentDate: shotDay },
    });

  console.log("\nComplete action for immunization");
  const early = await complete(shot._id, midwife, IMMUNIZATION_RECORD);
  const stillConfirmed = (await Appointment.findById(shot._id).lean()).status === "confirmed";
  check(
    "before the scheduled Thursday it is refused and nothing changes",
    early.status === 409 && early.body.message.includes("its scheduled day") && stillConfirmed,
    `${early.status} ${early.body.message}`
  );

  const today = await scheduledVisit(residentA, "immunization", new Date(startOfToday().getTime() + 9 * 60 * 60 * 1000));
  const onDay = await complete(today._id, midwife, IMMUNIZATION_RECORD);
  check(
    "on the scheduled day it completes and files a record",
    onDay.status === 201 && onDay.body.appointment.status === "completed" && Boolean(onDay.body.medicalRecord?._id),
    `${onDay.status} ${onDay.body.message}`
  );

  const yesterday = await scheduledVisit(residentA, "immunization", new Date(startOfToday().getTime() - DAY_MS + 9 * 60 * 60 * 1000));
  const late = await complete(yesterday._id, midwife, IMMUNIZATION_RECORD);
  check("after the scheduled day the existing behaviour (allowed) holds", late.status === 201, `${late.status} ${late.body.message}`);

  const bpEarly = await complete(bp._id, bhw, BP_RECORD);
  check("BP checking still completes ahead of its slot, as before", bpEarly.status === 201, `${bpEarly.status} ${bpEarly.body.message}`);

  console.log("\nCompleted appointments are locked");
  const cancelDone = await cancel(today._id, residentA);
  check(
    "a completed appointment cannot be cancelled",
    cancelDone.status === 409 && cancelDone.body.message === "Completed appointments cannot be rescheduled or cancelled."
  );
  check("a completed appointment cannot be rescheduled", (await reschedule(today._id, residentA)).status === 409);

  console.log("\nResident cancellation");
  const stranger = await cancel(shot._id, residentB);
  check("another resident cannot cancel it", stranger.status === 403, `${stranger.status}`);

  const cancelled = await cancel(shot._id, residentA);
  const stored = await Appointment.findById(shot._id).lean();
  const last = stored?.statusHistory.at(-1);
  check("the owner can cancel an active appointment", cancelled.status === 200 && stored?.status === "cancelled");
  check(
    "the record is kept with its history, reason, and actor",
    Boolean(stored) && last?.status === "cancelled" && String(last.changedBy) === String(residentA.user._id) &&
      stored.cancelReason === "Schedule conflict" && stored.statusHistory.length >= 2
  );
  check("the slot is released for the next patient", stored?.missionSchedule === null && stored?.slotStart === null);
  check(
    "the existing cancellation notification is sent",
    (await Notification.countDocuments({ appointment: shot._id, type: "appointment_cancelled" })) >= 1
  );

  const again = await cancel(shot._id, residentA);
  check(
    "a repeated cancel (double tap, retry) is a no-op, not a second change",
    again.status === 200 && again.body.message === "Appointment was already cancelled." &&
      (await Appointment.findById(shot._id).lean()).statusHistory.length === stored.statusHistory.length
  );
  const rescheduleCancelled = await reschedule(shot._id, residentA);
  check(
    "a cancelled appointment cannot be rescheduled",
    rescheduleCancelled.status === 409 && rescheduleCancelled.body.message === "This appointment has already been cancelled."
  );
  check("a cancelled appointment cannot be completed", (await complete(shot._id, midwife, IMMUNIZATION_RECORD)).status === 409);

  console.log("\nOther lifecycle locks");
  const serving = await scheduledVisit(residentA, "prenatal", new Date(Date.now() + DAY_MS), "processing");
  const cancelServing = await cancel(serving._id, residentA);
  check("a visit already being served cannot be cancelled", cancelServing.status === 409 && cancelServing.body.message.includes("already started"));

  const pending = await Appointment.create({
    resident: residentA.user._id,
    consultationType: "prenatal",
    ageTier: 4,
    prioritySortKey: 4,
    statusHistory: [{ status: "pending", timestamp: new Date() }],
  });
  const pendingOptions = await request(`/appointments/${pending._id}/reschedule-options`, { token: residentA.token });
  check("a pending request has no reschedule options yet", pendingOptions.status === 409 && pendingOptions.body.message.includes("no schedule yet"));
  check("a pending request can still be withdrawn", (await cancel(pending._id, residentA)).status === 200);
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
