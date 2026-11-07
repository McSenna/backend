"use strict";

// General checkups and consultations are requested, not booked: they enter the
// priority queue with no date or time, even when no doctor mission exists.
// Allocation onto missions is covered in doctorQueueAllocation.test.js.

const { createChecker, startHarness, createUser, finish } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const Notification = require("../../models/Notification");

let keyCount = 0;
const newKey = () => `queue-key-${Date.now().toString(36)}-${(keyCount += 1)}`;

/** Holds every insert back, so racing requests all pass the replay check before any writes. */
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
  const [alice, bea, cara, dee] = await Promise.all([1, 2, 3, 4].map(() => createUser("resident")));

  const options = (who, consultationType) =>
    request(`/appointments/booking-options?consultationType=${consultationType}`, { token: who.token });
  const submit = (who, body) => request("/appointments", { method: "POST", token: who.token, body });
  const ask = (consultationType, extra = {}) => ({
    consultationType,
    description: "Cough for three days",
    additionalNotes: "Mornings are better",
    requestKey: newKey(),
    ...extra,
  });
  const noticesFor = (who, extra = {}) => Notification.find({ recipient: who.user._id, ...extra }).lean();

  console.log("\nNo doctor mission exists, and requests are still accepted");
  check("there are no missions in the database", (await MissionSchedule.countDocuments()) === 0);
  const listed = await options(alice, "general_checkup");
  check("booking options say the service is queued, with no dates", listed.status === 200 && listed.body.scheduling === "queue" && !listed.body.schedules, JSON.stringify(listed.body));

  const forged = {
    missionScheduleId: "64b000000000000000000001",
    slotStart: new Date(Date.now() + 86400000).toISOString(),
    resident: String(bea.user._id),
    status: "confirmed",
  };
  const checkup = await submit(alice, ask("general_checkup", forged));
  const consult = await submit(dee, ask("consultation"));
  const stored = await Appointment.findById(checkup.body.appointment?._id).lean();
  check("a general checkup request is accepted", checkup.status === 201, `${checkup.status} ${checkup.body.message}`);
  check("a consultation request is accepted", consult.status === 201 && consult.body.appointment?.status === "pending", `${consult.status}`);
  check(
    "it is saved pending, with no mission, date or time",
    stored?.status === "pending" && stored.slotStart === null && stored.slotEnd === null && stored.missionSchedule === null
  );
  check("a client-supplied time, status and resident are ignored", String(stored?.resident) === String(alice.user._id));
  check("the submission time is recorded", stored?.createdAt instanceof Date);
  check("its priority group is set from the resident's age", stored?.ageTier === 6 && stored.prioritySortKey === 6 && stored.ageAtSubmission >= 18);
  check(
    "its history starts in the queue, with no approval step",
    stored?.statusHistory.length === 1 && stored.statusHistory[0].status === "pending" && stored.approvedAt === null && stored.assignedBy === null
  );
  check(
    "the response says queued, never confirmed",
    /queued/i.test(checkup.body.message) && !/confirmed/i.test(checkup.body.message),
    checkup.body.message
  );

  console.log("\nThe queued notification");
  const aliceNotices = await noticesFor(alice);
  const receipt = aliceNotices.find((n) => String(n.appointment) === String(stored?._id));
  check("one queued notice per request, and nothing else", aliceNotices.length === 1 && aliceNotices.every((n) => n.type === "appointment_queued"), aliceNotices.map((n) => n.type).join(","));
  check(
    "it names the service and says the time is still to be assigned",
    /General Checkup/.test(receipt?.body ?? "") && /will be assigned/.test(receipt?.body ?? "") && !/confirmed/i.test(receipt?.body ?? ""),
    receipt?.body
  );

  console.log("\nRetries and double taps");
  const retryBody = ask("general_checkup");
  const [first, second] = await withSlowInserts(() => Promise.all([submit(cara, retryBody), submit(cara, retryBody)]));
  const third = await submit(cara, retryBody);
  const caraRows = await Appointment.find({ resident: cara.user._id }).lean();
  check(
    "a double tap and a later retry make one request",
    caraRows.length === 1 && [first, second, third].every((r) => String(r.body.appointment?._id) === String(caraRows[0]?._id)),
    `${caraRows.length} ${first.status} ${second.status} ${third.status}`
  );
  check("the replay answers 200 with the same queued request", third.status === 200 && third.body.appointment.status === "pending" && /queued/i.test(third.body.message));
  check("retries never repeat the queued notice", (await noticesFor(cara)).length === 1);
  await Notification.deleteMany({ recipient: cara.user._id });
  await submit(cara, retryBody);
  check("a retry after a lost notice sends it once more, and only once", (await noticesFor(cara)).length === 1);

  console.log("\nOne doctor request waits per resident");
  const secondRequest = await submit(alice, ask("consultation"));
  check(
    "a second doctor request while one waits is refused, naming the waiting one",
    secondRequest.status === 409 && secondRequest.body.code === "DUPLICATE_BOOKING" && /general checkup request waiting in the queue/.test(secondRequest.body.message),
    `${secondRequest.status} ${secondRequest.body.message}`
  );
  const sameService = await submit(alice, ask("general_checkup"));
  check("so is a second request for the same service", sameService.status === 409 && sameService.body.code === "DUPLICATE_BOOKING");
  check(
    "the refusals saved nothing and sent nothing",
    (await Appointment.countDocuments({ resident: alice.user._id })) === 1 && (await noticesFor(alice)).length === 1
  );

  const [raceA, raceB] = await withSlowInserts(() =>
    Promise.all([submit(bea, ask("general_checkup")), submit(bea, ask("consultation"))])
  );
  const beaRows = await Appointment.find({ resident: bea.user._id }).lean();
  check(
    "two different requests sent at once make exactly one, and the other is refused",
    beaRows.length === 1 && [raceA.status, raceB.status].sort().join(",") === "201,409",
    `${beaRows.length} ${raceA.status} ${raceB.status}`
  );
  check("the refused one sent no notice", (await noticesFor(bea)).length === 1);
  await Appointment.deleteMany({ resident: bea.user._id });
  await Notification.deleteMany({ recipient: bea.user._id });

  // Saved directly: only the doctor queue counts, and only while it waits.
  const otherService = await Appointment.create({ resident: bea.user._id, consultationType: "bp_checking", description: "BP", status: "pending", ageTier: 6, prioritySortKey: 6 });
  const besideOther = await submit(bea, ask("consultation"));
  check("a waiting BP visit does not block a doctor request", besideOther.status === 201, `${besideOther.status} ${besideOther.body.message}`);
  await Appointment.updateOne({ _id: besideOther.body.appointment?._id }, { $set: { status: "confirmed" } });
  const afterPlaced = await submit(bea, ask("general_checkup"));
  check("a request that already has its time no longer blocks a new one", afterPlaced.status === 201, `${afterPlaced.status} ${afterPlaced.body.message}`);
  await Appointment.deleteMany({ resident: bea.user._id, _id: { $ne: otherService._id } });
  await Appointment.deleteOne({ _id: otherService._id });
  await Notification.deleteMany({ recipient: bea.user._id });

  console.log("\nRefused requests leave nothing behind");
  const noReason = await submit(bea, ask("general_checkup", { description: "  " }));
  check("a request without a reason is refused", noReason.status === 400 && noReason.body.code === "MISSING_FIELDS");
  const unknown = await submit(bea, ask("surgery"));
  check("an unknown service is refused", unknown.status === 400);
  const shot = await submit(bea, ask("immunization"));
  check("immunization cannot be requested here", shot.status === 400 && /assigned automatically/.test(shot.body.message));
  const badKey = await submit(bea, ask("consultation", { requestKey: "x" }));
  check("an unreadable request key is refused", badKey.status === 400);
  const staff = await submit(midwife, ask("general_checkup"));
  check("staff cannot request as a resident", staff.status === 403);
  check(
    "no refused request left an appointment or a notification",
    (await Appointment.countDocuments({ resident: bea.user._id })) === 0 && (await noticesFor(bea)).length === 0
  );

  console.log("\nWhat staff and the resident see");
  const pending = (await request("/appointments/pending", { token: doctor.token })).body.appointments ?? [];
  const row = pending.find((a) => String(a._id) === String(stored?._id));
  check("doctors see the request in their queue", Boolean(row) && row.queueRole === "doctor");
  check(
    "with its age group and why it is waiting",
    row?.priorityGroupLabel === "Adults 18 to 59" && row.queueWaitReason === "no_mission",
    JSON.stringify(row && { label: row.priorityGroupLabel, reason: row.queueWaitReason })
  );
  const midwifeQueue = (await request("/appointments/pending", { token: midwife.token })).body.appointments ?? [];
  check("the midwife's queue does not show doctor requests", !midwifeQueue.some((a) => a.consultationType === "general_checkup"));
  const mine = (await request("/appointments/me", { token: alice.token })).body.appointments ?? [];
  check("the resident sees the request pending, with no time", mine.length === 1 && mine.every((a) => a.status === "pending" && !a.slotStart));
  const confirmedList = (await request("/appointments?status=confirmed", { token: doctor.token })).body.appointments ?? [];
  check("a queued request is never listed as confirmed", !confirmedList.some((a) => String(a._id) === String(stored?._id)));

  console.log("\nA queued request cannot pick its own time");
  const move = await request(`/appointments/${stored?._id}/reschedule`, {
    method: "PATCH",
    token: alice.token,
    body: { missionScheduleId: forged.missionScheduleId, slotStart: forged.slotStart },
  });
  check("rescheduling a queued request is refused", move.status === 409 && /still in the queue/.test(move.body.message), `${move.status} ${move.body.message}`);
  const cancel = await request(`/appointments/${stored?._id}/cancel`, { method: "PATCH", token: alice.token, body: {} });
  check("a queued request can still be cancelled", cancel.status === 200 && cancel.body.appointment.status === "cancelled");
  const afterCancel = await submit(alice, ask("consultation"));
  check("once it is cancelled, the resident can send a new request", afterCancel.status === 201 && afterCancel.body.appointment?.status === "pending");
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
