"use strict";
const mongoose = require("mongoose");
const Baby = require("../../models/Baby");
const Dose = require("../../models/ImmunizationDose");
const Schedule = require("../../models/VaccineSchedule");
const MedicalRecord = require("../../models/MedicalRecord");
const { todayManila } = require("./calendar");

// A derived program summary, never a second copy of clinical dose records.
// Caller holds the Baby revision fence inside the clinical transaction.
const syncImmunizationMedicalRecord = async (baby, schedule, user, session) => {
  const records = await Dose.find({ babyId: baby._id }).session(session).lean();
  if (!records.length) return null;
  const keys = new Set(
    schedule.vaccines.flatMap((vaccine) =>
      vaccine.doses.map((dose) => dose.key),
    ),
  );
  const administered = records.filter(
    (record) => keys.has(record.doseKey) && record.state === "administered",
  ).length;
  const total = keys.size;
  const recordStatus =
    total > 0 && administered === total ? "completed" : "in_progress";
  const careDates = records
    .map(
      (record) =>
        (record.state === "administered" && record.administeredOn) ||
        todayManila(record.updatedAt || record.createdAt || new Date()),
    )
    .sort();
  return MedicalRecord.findOneAndUpdate(
    { immunizationBabyId: baby._id },
    {
      $set: {
        masterResidentId: baby.motherMasterResidentId,
        source: "manual_entry",
        serviceType: "immunization",
        immunizationScheduleVersion: schedule.version,
        recordStatus,
        workflowStatus: records.some(record => record.workflowStatus === "draft") ? "draft" : "completed",
        immunizationProgress: { administered, total },
        assessment: `Routine immunization checklist: ${administered} of ${total} doses documented as administered.`,
        completedAt: new Date(`${careDates.at(-1)}T00:00:00Z`),
        provider: user.userId,
        providerRole: "midwife",
        updatedBy: user.userId,
        updatedByRole: "midwife",
      },
      $setOnInsert: { createdBy: user.userId, createdByRole: "midwife" },
    },
    { upsert: true, returnDocument: "after", runValidators: true, session },
  ).lean();
};

// Backfill only identified baby ledgers. Ambiguous legacy medical records stay
// untouched, and existing program summaries retain their IDs and timestamps.
const backfillImmunizationMedicalRecords = async () => {
  let created = 0;
  for await (const row of Baby.find({}).select("_id").lean().cursor()) {
    const session = await mongoose.startSession();
    let inserted = false;
    try {
      await session.withTransaction(async () => {
        inserted = false;
        const baby = await Baby.findOneAndUpdate(
          { _id: row._id },
          { $inc: { revision: 1 } },
          { session, returnDocument: "after" },
        ).lean();
        if (
          !baby ||
          (await MedicalRecord.exists({ $or: [{ immunizationBabyId: baby._id }, { deletedImmunizationBabyId: baby._id }] }).withDeleted().session(
            session,
          ))
        )
          return;
        const latest = await Dose.findOne({ babyId: baby._id })
          .sort({ updatedAt: -1, createdAt: -1 })
          .session(session)
          .lean();
        const schedule = await Schedule.findOne({
          version: baby.scheduleVersion,
        })
          .session(session)
          .lean();
        if (!latest || !schedule) return;
        await syncImmunizationMedicalRecord(
          baby,
          schedule,
          { userId: latest.recordedBy },
          session,
        );
        inserted = true;
      });
      if (inserted) created++;
    } finally {
      await session.endSession();
    }
  }
  return { created };
};
const presentMedicalRecord = (record) =>
  record
    ? {
        _id: String(record._id),
        recordStatus: record.recordStatus,
        workflowStatus: record.workflowStatus,
        immunizationProgress: record.immunizationProgress,
      }
    : null;
module.exports = {
  syncImmunizationMedicalRecord,
  backfillImmunizationMedicalRecords,
  presentMedicalRecord,
};
