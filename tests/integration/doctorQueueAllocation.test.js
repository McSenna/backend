"use strict";

// Queued doctor requests are placed on medical missions by age group, then by
// submission time, and only into whole free slots. Pure planning rules (break,
// closing time, gap filling) are in tests/unit/doctorQueuePlanner.test.js.

const { createChecker, startHarness, createUser, upcomingDateKey, localAt, finish } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const Notification = require("../../models/Notification");
const User = require("../../models/User");
const { processUpcomingMissionSchedulesPriorityQueue } = require("../../services/triageQueue");

const GENERAL = { categoryKey: "general_checkup", durationMinutes: 20 };
const CONSULT = { categoryKey: "consultation", durationMinutes: 30 };
const iso = (date) => new Date(date).toISOString();
let keyCount = 0;
const newKey = () => `alloc-key-${Date.now().toString(36)}-${(keyCount += 1)}`;

const pad = (n) => String(n).padStart(2, "0");
/** A birth date `years` and `months` before today, as "YYYY-MM-DD". Every person here is invented. */
const bornAgo = (years, months = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years, d.getMonth() - months, Math.min(d.getDate(), 28));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const overlaps = (rows) =>
  rows.some((a, i) => rows.some((b, j) => i < j && a.slotStart < b.slotEnd && b.slotStart < a.slotEnd));

const run = async ({ request }, check) => {
  const doctor = await createUser("doctor");
  const submit = (who, consultationType = "general_checkup") =>
    request("/appointments", { method: "POST", token: who.token, body: { consultationType, description: "Check-up", requestKey: newKey() } });
  const createMission = (date, categories, startTime, endTime) =>
    request("/mission-schedule", { method: "POST", token: doctor.token, body: { date, categories, startTime, endTime } });
  const load = (id) => Appointment.findById(id).lean();
  const countNotices = (id, type) => Notification.countDocuments({ appointment: id, ...(type ? { type } : {}) });

  // Submitted lowest priority first, so the order below can only come from the age rule.
  const people = [
    ["unknown", await createUser("resident")],
    ["adult", await createUser("resident", bornAgo(30))],
    ["adolescent", await createUser("resident", bornAgo(15))],
    ["child", await createUser("resident", bornAgo(9))],
    ["young child", await createUser("resident", bornAgo(3))],
    ["senior", await createUser("resident", bornAgo(70))],
    ["infant", await createUser("resident", bornAgo(0, 6))],
    ["second adult", await createUser("resident", bornAgo(41))],
  ];
  await User.collection.updateOne({ _id: people[0][1].user._id }, { $unset: { dateOfBirth: "" } });

  const ids = {};
  for (const [name, who] of people) {
    const response = await submit(who);
    ids[name] = response.body.appointment?._id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  check("all eight requests are queued", (await Appointment.countDocuments({ status: "pending" })) === 8);

  const legacy = await Appointment.create({
    resident: people[1][1].user._id, consultationType: "consultation", description: "Older request",
    status: "pending", ageTier: 0, prioritySortKey: 0,
  });
  const queue = (await request("/appointments/pending", { token: doctor.token })).body.appointments ?? [];
  check("an older row stored under the five-tier rule is re-ranked on read", (await load(legacy._id)).ageTier === 6);
  check("the missing birth date is flagged for staff, last in line", queue.at(-1)?._id === String(ids.unknown) && queue.at(-1).priorityGroupLabel === "Birth date needed");
  await Appointment.deleteOne({ _id: legacy._id });

  console.log("\nA new mission places the queue in the exact age order");
  const DAY1 = upcomingDateKey(2, 1);
  const mission1 = (await createMission(DAY1, [GENERAL], "08:00", "10:00")).body.missionSchedule;
  const expected = ["infant", "senior", "young child", "child", "adolescent", "adult"];
  const placed = await Promise.all(expected.map((name) => load(ids[name])));
  const times = placed.map((a) => (a?.slotStart ? new Date(a.slotStart).toTimeString().slice(0, 5) : "none"));
  check("the six groups fill 08:00 to 10:00 in order", times.join(" ") === "08:00 08:20 08:40 09:00 09:20 09:40", times.join(" "));
  check("each is confirmed with a 20-minute slot on the mission", placed.every((a) => a.status === "confirmed" && a.slotEnd - a.slotStart === 20 * 60000 && String(a.missionSchedule) === String(mission1._id)));
  check("history shows the queue, then the automatic schedule", placed.every((a) => a.statusHistory.map((h) => h.status).join(",") === "pending,confirmed"));
  const residentConfirmations = await Promise.all(
    placed.map((a) => Notification.countDocuments({ appointment: a._id, recipient: a.resident, type: "appointment_confirmed" }))
  );
  check("each placed resident gets one confirmation", residentConfirmations.every((n) => n === 1), residentConfirmations.join(","));
  const [secondAdult, unknown] = [await load(ids["second adult"]), await load(ids.unknown)];
  check("when the mission is full, the rest stay queued with their history", secondAdult.status === "pending" && unknown.status === "pending" && secondAdult.statusHistory.length === 1);
  check("a request left in the queue gets no confirmation", (await countNotices(secondAdult._id, "appointment_confirmed")) === 0);
  const waiting = (await request("/appointments/pending", { token: doctor.token })).body.appointments ?? [];
  check("staff see why: the mission has no open time", waiting.every((a) => a.queueWaitReason === "no_open_time"));

  console.log("\nA new high-priority request never displaces a confirmed visit");
  const lateInfant = await createUser("resident", bornAgo(0, 2));
  const lateInfantId = (await submit(lateInfant)).body.appointment?._id;
  check("the late infant waits", (await load(lateInfantId)).status === "pending");
  check("the adult's confirmed 09:40 is untouched", iso((await load(ids.adult)).slotStart) === iso(localAt(DAY1, "09:40")));

  console.log("\nRepeated and simultaneous queue runs");
  const DAY2 = upcomingDateKey(3, 1);
  // Saved directly so no request triggers a run: two runs then race for its one slot.
  await MissionSchedule.create({ date: new Date(`${DAY2}T00:00:00+08:00`), morningStart: "08:00", morningEnd: "08:20", afternoonStart: "08:20", afternoonEnd: "08:20", categories: [GENERAL], createdBy: doctor.user._id });
  const [runA, runB] = await Promise.all([processUpcomingMissionSchedulesPriorityQueue(), processUpcomingMissionSchedulesPriorityQueue()]);
  const onDay2 = await Appointment.find({ slotStart: { $gte: localAt(DAY2, "00:00"), $lt: localAt(DAY2, "23:59") } }).lean();
  check("two simultaneous runs place exactly one visit in the single slot", onDay2.length === 1 && runA.totalAssigned + runB.totalAssigned === 1, `${onDay2.length} ${runA.totalAssigned}+${runB.totalAssigned}`);
  check("the highest-priority waiting request got it", String(onDay2[0]?._id) === String(lateInfantId));
  await processUpcomingMissionSchedulesPriorityQueue();
  check("a repeated run changes nothing and sends nothing again", (await countNotices(lateInfantId, "appointment_confirmed")) === 1 && (await Appointment.countDocuments({ status: "confirmed" })) === 7);

  console.log("\nA request that finds room is scheduled at once");
  const DAY3 = upcomingDateKey(4, 1);
  await createMission(DAY3, [CONSULT], "08:00", "09:00");
  const walkIn = await createUser("resident", bornAgo(25));
  const walkInResponse = await submit(walkIn, "consultation");
  const walkInRow = await load(walkInResponse.body.appointment?._id);
  check("it is confirmed with a 30-minute consultation slot", walkInRow?.status === "confirmed" && walkInRow.slotEnd - walkInRow.slotStart === 30 * 60000);
  check("the response says it was scheduled", walkInResponse.status === 201 && walkInResponse.body.appointment.status === "confirmed" && /scheduled/.test(walkInResponse.body.message));
  const walkInNotices = await Notification.find({ appointment: walkInRow?._id }).sort({ createdAt: 1, _id: 1 }).lean();
  check("the resident is told queued, then confirmed", walkInNotices.map((n) => n.type).join(",") === "appointment_queued,appointment_confirmed", walkInNotices.map((n) => n.type).join(","));

  console.log("\nMission edits and removal return visits to the queue");
  const shrunk = await request(`/mission-schedule/${mission1._id}`, { method: "PATCH", token: doctor.token, body: { startTime: "08:00", endTime: "09:00", categories: [GENERAL] } });
  check("the mission is shortened to 08:00 to 09:00", shrunk.status === 200);
  const released = await Promise.all(["child", "adolescent", "adult"].map((name) => load(ids[name])));
  check("the three visits after 09:00 are back in the queue", released.every((a) => a.status === "pending" && a.slotStart === null && a.missionSchedule === null));
  check("their history records why, and their request time is kept", released.every((a) => a.statusHistory.at(-1).status === "pending" && /schedule changed/.test(a.statusHistory.at(-1).note)));
  const releasedNotices = await Promise.all(released.map((a) => Notification.find({ appointment: a._id, title: "Appointment moved back to the queue" }).lean()));
  check("each resident is told once, with the time they lost", releasedNotices.every((list) => list.length === 1 && /was moved back to the queue/.test(list[0].body)));
  const kept = await Promise.all(["infant", "senior", "young child"].map((name) => load(ids[name])));
  check("visits that still fit keep their times", kept.every((a) => a.status === "confirmed"));

  await request(`/mission-schedule/${mission1._id}`, { method: "DELETE", token: doctor.token });
  const afterDelete = await Promise.all(["infant", "senior", "young child"].map((name) => load(ids[name])));
  check("removing the mission returns its visits to the queue", afterDelete.every((a) => a.status === "pending" && a.slotStart === null));
  check("their earlier history is kept", afterDelete.every((a) => a.statusHistory.map((h) => h.status).join(",") === "pending,confirmed,pending"));

  console.log("\nA freed slot goes to the next in line");
  const cancel = await request(`/appointments/${lateInfantId}/cancel`, { method: "PATCH", token: lateInfant.token, body: {} });
  check("the late infant cancels", cancel.status === 200);
  const refilled = await Appointment.find({ slotStart: { $gte: localAt(DAY2, "00:00"), $lt: localAt(DAY2, "23:59") }, status: "confirmed" }).lean();
  check("the earliest-requested infant takes the freed slot", refilled.length === 1 && String(refilled[0]._id) === String(ids.infant), String(refilled[0]?._id));
  const all = await Appointment.find({ status: "confirmed" }).lean();
  check("no two confirmed visits on any mission overlap", !overlaps(all));
  check("no request holds more than one slot", new Set(all.map((a) => String(a._id))).size === all.length);
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
