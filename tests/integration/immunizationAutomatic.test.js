"use strict";
process.env.TZ = "Asia/Manila";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Baby = require("../../models/Baby");
const User = require("../../models/User");
const Schedule = require("../../models/VaccineSchedule");
const Appointment = require("../../models/Appointment");
const Dose = require("../../models/ImmunizationDose");
const Notification = require("../../models/Notification");
require("../../models/MedicalRecord");
require("../../models/MissionSchedule");
const {
  runAutomaticImmunizationAppointments,
} = require("../../services/immunization/automaticAppointments");
(async () => {
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  try {
    await mongoose.connect(repl.getUri());
    await Promise.all([
      Baby.init(),
      User.init(),
      Schedule.init(),
      Appointment.init(),
      Dose.init(),
      Notification.init(),
    ]);
    const mother = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: mother,
      email: "auto-mother@example.test",
      fullname: "Fictional mother",
      role: "resident",
      verified: true,
      status: "active",
      verificationMethod: "master_list",
      masterResidentId: "AUTO-MOTHER",
      immunizationRemindersEnabled: false,
    });
    await Schedule.create({
      version: "auto-test",
      title: "Test only",
      source: "Test only",
      effectiveOn: "2026-01-01",
      activationStatus: "active",
      dueWindowDays: 7,
      reminderDays: [7, 1, 0],
      slots: [{ key: "w6", label: "6 weeks", days: 42 }],
      vaccines: [
        {
          key: "a",
          name: "Test A",
          doses: [{ key: "a1", label: "Dose 1", slot: "w6" }],
        },
        {
          key: "b",
          name: "Test B",
          doses: [{ key: "b1", label: "Dose 1", slot: "w6" }],
        },
      ],
    });
    const createBaby = async (key, motherId = "AUTO-MOTHER") =>
      Baby.create({
        motherMasterResidentId: motherId,
        name: "Fictional twin",
        dateOfBirth: "2026-08-30",
        scheduleVersion: "auto-test",
        createdBy: mother,
        requestKey: key,
      });
    const first = await createBaby("auto-one");
    const now = new Date("2026-10-08T00:00:00Z");
    await Promise.all([
      runAutomaticImmunizationAppointments({ now }),
      runAutomaticImmunizationAppointments({ now }),
    ]);
    let rows = await Appointment.find({ immunizationBabyId: first._id }).lean();
    assert.equal(rows.length, 1, "concurrent runs create one grouped visit");
    assert.equal(
      rows[0].slotStart.toISOString(),
      "2026-10-15T00:00:00.000Z",
      "Sunday six-week target is assigned Thursday at 8 AM Manila",
    );
    assert.deepEqual(rows[0].immunizationDoseKeys, ["a1", "b1"]);
    assert.equal(rows[0].resident.toString(), mother.toString());
    const twin = await createBaby("auto-two");
    await runAutomaticImmunizationAppointments({ now });
    const twinVisit = await Appointment.findOne({
      immunizationBabyId: twin._id,
    }).lean();
    assert.equal(
      twinVisit.slotStart.toISOString(),
      "2026-10-15T00:10:00.000Z",
      "twins with the same name remain independent",
    );
    const unlinked = await createBaby("auto-unlinked", "NO-ACCOUNT");
    await runAutomaticImmunizationAppointments({ now });
    assert.equal(
      await Appointment.countDocuments({ immunizationBabyId: unlinked._id }),
      0,
    );
    await User.updateOne(
      { _id: mother },
      { $set: { immunizationRemindersEnabled: true } },
    );
    await require("../../services/immunization/reminderWorker").runImmunizationReminders(
      { now },
    );
    const notice = await Notification.findOne({
      immunizationBabyId: first._id,
    }).lean();
    assert.equal(
      notice.immunizationDetail.scheduledOn,
      "2026-10-15",
      "reminders follow the assigned Thursday rather than Sunday",
    );
    const cancelMother = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: cancelMother,
      email: "auto-cancel@example.test",
      fullname: "Fictional cancellation",
      role: "resident",
      verified: true,
      status: "active",
      verificationMethod: "master_list",
      masterResidentId: "AUTO-CANCEL",
      immunizationRemindersEnabled: true,
    });
    const cancelBaby = await createBaby("auto-cancel", "AUTO-CANCEL");
    await require("../../services/immunization/reminderWorker").runImmunizationReminders(
      { now },
    );
    const cancelVisit = await Appointment.findOne({
      immunizationBabyId: cancelBaby._id,
    }).lean();
    const cancelReminder = await require("../../models/ImmunizationReminder")
      .findOne({ babyId: cancelBaby._id })
      .lean();
    assert.equal(cancelReminder.status, "delivered");
    await require("../../services/residentAppointment/cancel").cancelAppointmentByResident(
      {
        appointmentId: cancelVisit._id,
        residentId: cancelMother,
        actorRole: "resident",
        reason: "Vaccine follow-up changed or no outstanding doses remain",
      },
    );
    assert.equal(
      (
        await require("../../models/ImmunizationReminder")
          .findById(cancelReminder._id)
          .lean()
      ).status,
      "cancelled",
      "cancellation immediately invalidates reminder details",
    );
    await require("../../services/immunization/reminderWorker").runImmunizationReminders(
      { now },
    );
    assert.equal(
      await Appointment.countDocuments({
        immunizationBabyId: cancelBaby._id,
        status: "confirmed",
      }),
      0,
      "a parent-cancelled visit is not silently recreated",
    );
    await Dose.collection.insertOne({
      babyId: first._id,
      doseKey: "a1",
      state: "deferred",
      followUpOn: "2026-10-18",
      recordedBy: mother,
      scheduleVersion: "auto-test",
      history: [],
      revision: 0,
    });
    await runAutomaticImmunizationAppointments({ now });
    const moved = await Appointment.findOne({
      immunizationBabyId: first._id,
      immunizationTargetOn: "2026-10-18",
    }).lean();
    assert.equal(moved.slotStart.toISOString(), "2026-10-22T00:00:00.000Z");
    rows = await Appointment.find({
      immunizationBabyId: first._id,
      immunizationTargetOn: "2026-10-11",
    }).lean();
    assert.deepEqual(
      rows[0].immunizationDoseKeys,
      ["b1"],
      "partial follow-up removes only the moved dose from the old visit",
    );
    await Dose.collection.insertOne({
      babyId: first._id,
      doseKey: "b1",
      state: "deferred",
      followUpOn: "2026-10-18",
      recordedBy: mother,
      scheduleVersion: "auto-test",
      history: [],
      revision: 0,
    });
    await runAutomaticImmunizationAppointments({ now });
    assert.equal(
      (await Appointment.findById(rows[0]._id).lean()).status,
      "cancelled",
      "empty old visit releases capacity",
    );
    await Dose.updateMany(
      { babyId: first._id },
      { $set: { followUpOn: "2026-10-11" } },
    );
    await runAutomaticImmunizationAppointments({ now });
    assert.equal(
      (await Appointment.findById(rows[0]._id).lean()).status,
      "confirmed",
      "restoring a documented follow-up reuses and reopens the system-cancelled visit",
    );
    await Appointment.updateOne(
      { _id: rows[0]._id },
      { $set: { status: "processing" } },
    );
    const replacement = new mongoose.Types.ObjectId();
    await User.updateOne({ _id: mother }, { $unset: { masterResidentId: "" } });
    await User.collection.insertOne({
      _id: replacement,
      email: "auto-corrected@example.test",
      fullname: "Fictional corrected account",
      role: "resident",
      verified: true,
      status: "active",
      verificationMethod: "admin_review",
      masterResidentId: "AUTO-MOTHER",
    });
    const visible =
      await require("../../services/immunization/appointmentAccess").protectedAppointmentRows(
        await Appointment.find({ resident: mother }).lean(),
      );
    assert.equal(
      visible.length,
      0,
      "unlink immediately hides automatic baby appointments",
    );
    await runAutomaticImmunizationAppointments({ now });
    assert.equal(
      await Appointment.countDocuments({
        resident: mother,
        status: "confirmed",
      }),
      0,
      "old account reservations release capacity after linkage correction",
    );
    assert.equal(
      await Appointment.countDocuments({
        resident: replacement,
        immunizationBabyId: { $in: [first._id, twin._id] },
        status: "confirmed",
      }),
      1,
      "an in-progress visit blocks a duplicate for the corrected account; the other twin is reassigned",
    );
    assert.equal(
      await Appointment.countDocuments({
        resident: mother,
        immunizationBabyId: first._id,
        status: "processing",
      }),
      1,
      "in-progress clinical history is retained for midwife resolution",
    );
    const filler = new mongoose.Types.ObjectId();
    const held = await Appointment.find({
      status: { $in: ["confirmed", "processing"] },
      slotStart: {
        $gte: new Date("2026-10-15T00:00:00Z"),
        $lt: new Date("2026-10-15T04:00:00Z"),
      },
    }).lean();
    for (let index = 0; index < 24; index++) {
      const start = new Date(
        new Date("2026-10-15T00:00:00Z").getTime() + index * 600000,
      );
      if (held.some((row) => row.slotStart.getTime() === start.getTime()))
        continue;
      await Appointment.create({
        resident: filler,
        consultationType: "immunization",
        ageTier: 0,
        prioritySortKey: 0,
        status: "confirmed",
        slotStart: start,
        slotEnd: new Date(start.getTime() + 600000),
        immunizationSlotKey: start.toISOString(),
      });
    }
    const capacity = await createBaby("auto-capacity");
    await runAutomaticImmunizationAppointments({ now });
    assert.equal(
      (
        await Appointment.findOne({
          immunizationBabyId: capacity._id,
          status: "confirmed",
        }).lean()
      ).slotStart.toISOString(),
      "2026-10-22T00:00:00.000Z",
      "a full Thursday rolls to the following Thursday without overlap",
    );
    await Schedule.updateOne(
      { version: "auto-test" },
      { $set: { activationStatus: "pending_verification" } },
    );
    const waiting = await createBaby("auto-inactive");
    await runAutomaticImmunizationAppointments({ now });
    assert.equal(
      await Appointment.countDocuments({ immunizationBabyId: waiting._id }),
      0,
      "inactive schedule cannot reserve visits",
    );
    console.log(
      "Automatic Thursday appointments, twins, grouping, account gates, concurrency, follow-up and reminder integration passed",
    );
  } finally {
    await mongoose.disconnect();
    await repl.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
