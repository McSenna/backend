"use strict";
const Baby = require("../../models/Baby");
const Dose = require("../../models/ImmunizationDose");
const Schedule = require("../../models/VaccineSchedule");
const Reminder = require("../../models/ImmunizationReminder");
const Notification = require("../../models/Notification");
const Appointment = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const { ensureInitialSchedule } = require("./registry");
// Additive indexes only: never infer babies or doses from old free-text records.
const initializeImmunization = async () => {
  await Promise.all([
    Baby.init(),
    Dose.init(),
    Schedule.init(),
    Reminder.init(),
    Notification.init(),
    Appointment.init(),
    MedicalRecord.init(),
  ]);
  await Promise.all([
    Baby.createIndexes(),
    Dose.createIndexes(),
    Schedule.createIndexes(),
    Reminder.createIndexes(),
    Notification.createIndexes(),
    Appointment.createIndexes(),
    MedicalRecord.createIndexes(),
  ]);
  await ensureInitialSchedule();
  // Older dose ledgers predate the ongoing medical-record summary. Restore only
  // missing derived entries before serving lists; never infer babies from text.
  const summaries =
    await require("./medicalRecordSummary").backfillImmunizationMedicalRecords();
  return { createdMedicalRecords: summaries.created };
};
module.exports = { initializeImmunization };
