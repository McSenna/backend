"use strict";

const {
  createChecker,
  startHarness,
  createUser,
  upcomingDateKey,
  localAt,
  finish,
  DAY_MS,
} = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const Notification = require("../../models/Notification");

const GENERAL = { categoryKey: "general_checkup", durationMinutes: 20 };
const BP = { categoryKey: "bp_checking", durationMinutes: 5 };
const iso = (date) => new Date(date).toISOString();
let keyCount = 0;
const newKey = () => `test-key-${Date.now().toString(36)}-${(keyCount += 1)}`;

/**
 * Holds every insert back so all racing requests read availability before any
 * of them writes. Only the mission lock can then keep them from double-booking.
 */
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

const overlaps = (rows) =>
  rows.some((a, i) => rows.some((b, j) => i < j && a.slotStart < b.slotEnd && b.slotStart < a.slotEnd));

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const [alice, bea, cara, dee] = [
    await createUser("resident"),
    await createUser("resident"),
    await createUser("resident"),
    await createUser("resident"),
  ];
  const racers = [];
  for (let i = 0; i < 4; i += 1) racers.push(await createUser("resident"));

  const thursdayKey = upcomingDateKey(4);
  const wednesdayKey = upcomingDateKey(3);
  const mission = (
    await request("/mission-schedule", {
      method: "POST",
      token: doctor.token,
      body: { date: thursdayKey, categories: [GENERAL, BP] },
    })
  ).body.missionSchedule;
  const wednesday = (
    await request("/mission-schedule", {
      method: "POST",
      token: doctor.token,
      body: { date: wednesdayKey, categories: [BP] },
    })
  ).body.missionSchedule;

  const options = (who, consultationType) =>
    request(`/appointments/booking-options?consultationType=${consultationType}`, { token: who.token });
  const book = (who, body) => request("/appointments", { method: "POST", token: who.token, body });
  const general = (slotStart, extra = {}) => ({
    consultationType: "general_checkup",
    description: "Cough for three days",
    additionalNotes: "Mornings are better",
    missionScheduleId: String(mission._id),
    slotStart,
    requestKey: newKey(),
    ...extra,
  });

  console.log("\nBooking options");
  const listed = await options(alice, "general_checkup");
  const thursdayOption = listed.body.schedules?.find((s) => s.missionScheduleId === String(mission._id));
  check("residents can load open dates for a service", listed.status === 200 && Boolean(thursdayOption), `${listed.status}`);
  const starts = thursdayOption?.availableSlotStarts ?? [];
  check(
    "times start at 08:00 and leave room for the 20-minute visit before noon",
    starts[0] === iso(localAt(thursdayKey, "08:00")) &&
      starts.includes(iso(localAt(thursdayKey, "11:40"))) &&
      !starts.includes(iso(localAt(thursdayKey, "11:45"))),
    JSON.stringify(starts.slice(0, 3))
  );
  check(
    "a mission that does not offer the service is not listed",
    !listed.body.schedules.some((s) => s.missionScheduleId === String(wednesday._id))
  );
  const shotOptions = (await options(alice, "immunization")).body;
  check(
    "immunization lists its own Wednesdays, not missions",
    shotOptions.scheduling === "weekly" && shotOptions.days.length > 0 && shotOptions.days.every((d) => new Date(d.date).getDay() === 3),
    JSON.stringify(shotOptions.days?.map((d) => d.dateKey))
  );
  const unknownOptions = await options(alice, "surgery");
  check("an unknown service is refused", unknownOptions.status === 400, `${unknownOptions.status}`);
  const staffOptions = await options(midwife, "general_checkup");
  check("staff cannot use the resident booking options", staffOptions.status === 403, `${staffOptions.status}`);

  console.log("\nA valid booking is confirmed immediately");
  const eight = iso(localAt(thursdayKey, "08:00"));
  const notesBefore = await Notification.countDocuments({ recipient: alice.user._id });
  const booked = await book(alice, general(eight, { resident: String(bea.user._id), status: "pending" }));
  const stored = await Appointment.findById(booked.body.appointment?._id).lean();
  check("the booking is created", booked.status === 201, `${booked.status} ${booked.body.message}`);
  check(
    "it is stored as confirmed with the chosen slot and its 20-minute length",
    stored?.status === "confirmed" &&
      iso(stored.slotStart) === eight &&
      stored.slotEnd - stored.slotStart === 20 * 60000 &&
      String(stored.missionSchedule) === String(mission._id) &&
      stored.assignedCategoryKey === "general_checkup" &&
      stored.assignedDurationMinutes === 20,
    JSON.stringify(stored && { status: stored.status, slotStart: stored.slotStart })
  );
  check(
    "the resident comes from the session, not the request body",
    String(stored?.resident) === String(alice.user._id)
  );
  check(
    "the reason and notes are kept",
    stored?.description === "Cough for three days" && stored?.additionalNotes === "Mornings are better"
  );
  check(
    "its history starts at confirmed, with no pending step and no approver",
    stored?.statusHistory.length === 1 && stored.statusHistory[0].status === "confirmed" &&
      stored.assignedBy === null && stored.approvedAt instanceof Date
  );
  check(
    "the response says it is confirmed",
    booked.body.appointment?.status === "confirmed" && /confirmed/i.test(booked.body.message ?? ""),
    booked.body.message
  );

  console.log("\nNo approval step");
  const pendingQueue = (await request("/appointments/pending", { token: doctor.token })).body.appointments ?? [];
  check("it never enters the staff pending queue", !pendingQueue.some((a) => String(a._id) === String(stored._id)));
  const confirmedList = (await request("/appointments?status=confirmed", { token: doctor.token })).body.appointments ?? [];
  check("staff see it in the confirmed list", confirmedList.some((a) => String(a._id) === String(stored._id)));
  const mine = (await request("/appointments/me", { token: alice.token })).body.appointments ?? [];
  const myRow = mine.find((a) => String(a._id) === String(stored._id));
  check(
    "the resident sees it confirmed, with its date, in their list",
    myRow?.status === "confirmed" && iso(myRow.slotStart) === eight && Boolean(myRow.missionSchedule?.date)
  );
  const notice = await Notification.findOne({ recipient: alice.user._id, appointment: stored._id }).lean();
  check(
    "the existing confirmation notification is sent",
    notice?.type === "appointment_confirmed" &&
      (await Notification.countDocuments({ recipient: alice.user._id })) === notesBefore + 1
  );
  const relisted = (await options(bea, "general_checkup")).body.schedules.find((s) => s.missionScheduleId === String(mission._id));
  check("the slot drops out of everyone's options", !relisted.availableSlotStarts.includes(eight));

  console.log("\nUnavailable and invalid slots are refused");
  const taken = await book(bea, general(eight));
  check("a taken slot is refused as unavailable", taken.status === 409 && taken.body.code === "SLOT_UNAVAILABLE", `${taken.status}`);
  const overlap = await book(bea, general(iso(localAt(thursdayKey, "08:10"))));
  check("a time that overlaps a booked visit is refused", overlap.status === 409 && overlap.body.code === "SLOT_UNAVAILABLE", `${overlap.status}`);
  const offGrid = await book(bea, general(iso(localAt(thursdayKey, "09:03"))));
  check("a time off the slot grid is refused", offGrid.status === 400, `${offGrid.status} ${offGrid.body.message}`);
  const lunch = await book(bea, general(iso(localAt(thursdayKey, "12:00"))));
  check("a time outside the mission hours is refused", lunch.status === 400, `${lunch.status}`);
  const pastMission = await MissionSchedule.create({
    date: new Date(Date.now() - 2 * DAY_MS),
    categories: [GENERAL],
    createdBy: doctor.user._id,
  });
  const past = await book(bea, general(iso(new Date(pastMission.date.getTime() + 9 * 3600000)), { missionScheduleId: String(pastMission._id) }));
  check("a past time is refused", past.status === 400, `${past.status}`);
  const wrongMission = await book(bea, general(iso(localAt(wednesdayKey, "08:00")), { missionScheduleId: String(wednesday._id) }));
  check("a mission that does not offer the service is refused", wrongMission.status === 400, `${wrongMission.status}`);
  const noReason = await book(bea, general(iso(localAt(thursdayKey, "09:00")), { description: "   " }));
  check("a booking without a reason is refused", noReason.status === 400 && noReason.body.code === "MISSING_FIELDS", `${noReason.status}`);
  const noSlot = await book(bea, general(undefined));
  check("a booking without a time is refused", noSlot.status === 400 && noSlot.body.code === "MISSING_FIELDS", `${noSlot.status}`);
  const badMission = await book(bea, general(iso(localAt(thursdayKey, "09:00")), { missionScheduleId: "not-an-id" }));
  check("a malformed mission id is refused", badMission.status === 400, `${badMission.status}`);
  const staffBooking = await book(midwife, general(iso(localAt(thursdayKey, "09:00"))));
  check("staff cannot book as a resident", staffBooking.status === 403, `${staffBooking.status}`);
  check(
    "no refused attempt left an appointment or notification behind",
    (await Appointment.countDocuments({ resident: bea.user._id })) === 0 &&
      (await Notification.countDocuments({ recipient: bea.user._id })) === 0
  );

  console.log("\nSimultaneous bookings for one slot");
  const contested = iso(localAt(thursdayKey, "09:00"));
  const race = await withSlowInserts(() => Promise.all(racers.map((who) => book(who, general(contested)))));
  const codes = race.map((r) => r.status).sort().join(",");
  check("exactly one resident gets the slot", codes === "201,409,409,409", codes);
  const onMission = await Appointment.find({ missionSchedule: mission._id, status: "confirmed" }).lean();
  check("no two appointments overlap", !overlaps(onMission), `${onMission.length}`);
  check("only one appointment holds 09:00", onMission.filter((a) => iso(a.slotStart) === contested).length === 1);

  console.log("\nRepeated submissions");
  const retryBody = general(iso(localAt(thursdayKey, "10:00")));
  const [first, second] = await withSlowInserts(() => Promise.all([book(cara, retryBody), book(cara, retryBody)]));
  const third = await book(cara, retryBody);
  const caraRows = await Appointment.find({ resident: cara.user._id, consultationType: "general_checkup" }).lean();
  check(
    "a double tap and a later retry with the same request key create one appointment",
    caraRows.length === 1 &&
      [first, second, third].every((r) => String(r.body.appointment?._id) === String(caraRows[0]._id)),
    `${caraRows.length} ${first.status} ${second.status} ${third.status}`
  );
  check("the replay answers 200 with the original booking", third.status === 200 && third.body.appointment.status === "confirmed");
  check(
    "a replay sends no second notification",
    (await Notification.countDocuments({ recipient: cara.user._id, appointment: caraRows[0]._id })) === 1
  );
  const sameDay = await book(cara, general(iso(localAt(thursdayKey, "14:00"))));
  check(
    "a second booking of the same service on the same day is refused",
    sameDay.status === 409 && sameDay.body.code === "DUPLICATE_BOOKING",
    `${sameDay.status} ${sameDay.body.code}`
  );
  const otherService = await book(cara, {
    ...general(iso(localAt(thursdayKey, "14:00"))),
    consultationType: "bp_checking",
  });
  check("a different service on the same day is still allowed", otherService.status === 201, `${otherService.status}`);

  console.log("\nCancelling and rescheduling still work");
  const cancel = await request(`/appointments/${stored._id}/cancel`, { method: "PATCH", token: alice.token, body: {} });
  check("the resident can cancel a booking", cancel.status === 200 && cancel.body.appointment.status === "cancelled");
  const rebook = await book(dee, general(eight));
  check("the cancelled slot can be booked again", rebook.status === 201, `${rebook.status} ${rebook.body.message}`);
  const moveTo = iso(localAt(thursdayKey, "15:00"));
  const moved = await request(`/appointments/${rebook.body.appointment._id}/reschedule`, {
    method: "PATCH",
    token: dee.token,
    body: { missionScheduleId: String(mission._id), slotStart: moveTo },
  });
  check(
    "a booked appointment can be rescheduled",
    moved.status === 200 && moved.body.appointment.status === "rescheduled" && iso(moved.body.appointment.slotStart) === moveTo,
    `${moved.status} ${moved.body.message}`
  );
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
