"use strict";

const assert = require("node:assert/strict");
const { startHarness, createUser } = require("./helpers/appointmentHarness");

let harness;
async function run() {
  harness = await startHarness();
  const { runPushCycle } = require("../../services/notification/pushWorker");
  const Appointment = require("../../models/Appointment");
  const Notification = require("../../models/Notification");
  const Device = require("../../models/PushDevice");
  const Delivery = require("../../models/PushDelivery");
  const { user } = await createUser("resident");
  const other = await createUser("resident");
  await Device.init();
  await Delivery.init();
  await Device.create({
    user: user._id, deviceId: "550e8400-e29b-41d4-a716-446655440001",
    pushToken: "ExpoPushToken[content-test]", platform: "android", sessionId: "content-test",
    tokenVersion: 0, expiresAt: new Date(Date.now() + 86400000),
  });
  const appointment = await Appointment.create({
    resident: user._id, consultationType: "test_service", description: "Sensitive clinical notes",
    status: "confirmed", slotStart: new Date("2026-11-20T01:30:00Z"),
    ageTier: 1, prioritySortKey: 1,
  });
  const foreignAppointment = await Appointment.create({
    resident: other.user._id, consultationType: "test_service", status: "confirmed",
    slotStart: new Date("2026-11-21T02:45:00Z"), ageTier: 1, prioritySortKey: 1,
  });
  const sent = [];
  const fetchImpl = async (url, options) => {
    assert.ok(url.endsWith("/send"), "new deliveries should request a push ticket");
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ data: { status: "ok", id: `ticket-${sent.length}` } }) };
  };
  const cases = [
    {
      type: "announcement", body: "Free community event at the barangay hall on Friday.",
      title: "Announcement", expected: "Free community event at the barangay hall on Friday.",
    },
    {
      type: "announcement", body: `${"A".repeat(490)}${"📅".repeat(15)}`,
      title: "Announcement", expected: `${"A".repeat(490)}${"📅".repeat(7)}...`,
    },
    {
      type: "appointment_confirmed", appointment: appointment._id,
      title: "Appointment", expected: "Your appointment is confirmed for Nov 20, 2026 at 9:30 AM (Asia/Manila).",
    },
    {
      type: "appointment_rescheduled", appointment: appointment._id,
      title: "Appointment", expected: "Your appointment has been rescheduled to Nov 20, 2026 at 9:30 AM (Asia/Manila).",
    },
    {
      type: "appointment_queued", appointment: appointment._id,
      title: "Appointment", expected: "Your appointment request is queued. We will notify you when a date and time are assigned.",
    },
    { type: "appointment_cancelled", title: "Appointment", expected: "Your appointment has been cancelled." },
    { type: "appointment_declined", title: "Appointment", expected: "Your appointment request has been declined." },
    { type: "appointment_completed", title: "Appointment", expected: "Your appointment has been completed." },
    { type: "appointment_confirmed", title: "Appointment", expected: "Your appointment is confirmed. Open MaslogCare for details." },
    {
      type: "appointment_confirmed", appointment: foreignAppointment._id,
      title: "Appointment", expected: "Your appointment is confirmed. Open MaslogCare for details.",
    },
    { type: "medical_record", title: "MaslogCare", expected: "Open MaslogCare to view your notification." },
  ];

  for (const item of cases) {
    const row = await Notification.create({
      recipient: user._id, type: item.type, appointment: item.appointment,
      title: "Sensitive private title", body: item.body || "Sensitive visit reason and patient name",
    });
    const before = sent.length;
    await runPushCycle({ fetchImpl });
    assert.equal(sent.length, before + 1, `${item.type} should send once`);
    const payload = sent.at(-1);
    assert.equal(payload.title, item.title, `${item.type} should use its category title`);
    assert.equal(payload.body, item.expected, `${item.type} should show the intended message`);
    assert.equal(payload.data.notificationId, String(row._id));
    assert.equal(payload.data.recipientId, String(user._id));
    assert.equal(payload.channelId, "maslogcare-default");
    assert.ok(!JSON.stringify(payload).includes("Sensitive"), "private clinical text stays in the inbox");
    assert.equal((await Delivery.findOne({ notification: row._id })).state, "receipt");
  }
  console.log("Push category titles, announcement text, appointment schedules and private-detail exclusions passed");
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => harness?.stop());
