"use strict";
const mongoose = require("mongoose");
const Baby = require("../../models/Baby");
const Dose = require("../../models/ImmunizationDose");
const Schedule = require("../../models/VaccineSchedule");
const Appointment = require("../../models/Appointment");
const User = require("../../models/User");
const { verifiedAccountFilter } = require("./access");
const { nextThursday, clinicalVisits } = require("./appointmentPlan");
const { todayManila, addDays } = require("./calendar");
const { getCategory } = require("../../config/consultationCategories");
const { assignVisit } = require("./automaticAssignment");
const logger = require("../../utils/logger");
const reconcileRemovedVisits = async (babyId, now) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const baby = await Baby.findOneAndUpdate(
        { _id: babyId },
        { $inc: { revision: 1 } },
        { session, returnDocument: "after" },
      ).lean();
      if (!baby) return;
      const schedule = await Schedule.findOne({ version: baby.scheduleVersion })
        .session(session)
        .lean();
      if (!schedule) return;
      const records = await Dose.find({ babyId }).session(session).lean();
      const account = await User.findOne(
        verifiedAccountFilter(baby.motherMasterResidentId),
      )
        .select("_id")
        .session(session)
        .lean();
      const visits = clinicalVisits(baby, schedule, records, todayManila(now));
      const rows = await Appointment.find({
        immunizationBabyId: babyId,
        status: { $in: ["confirmed", "rescheduled"] },
      }).session(session);
      for (const row of rows) {
        const linked = account && String(account._id) === String(row.resident);
        const current = linked
          ? visits.find(
              (visit) =>
                visit.thursday === nextThursday(row.immunizationTargetOn),
            )
          : null;
        const remaining = current?.doseKeys || [];
        if (row.immunizationDoseKeys.join() !== remaining.join())
          row.immunizationDoseKeys = remaining;
        const administeredAtVisit = records.some(
          (record) =>
            record.state === "administered" &&
            record.administeredOn === todayManila(row.slotStart),
        );
        if (!current && (!administeredAtVisit || !linked)) {
          row.status = "cancelled";
          row.immunizationCancellationOrigin = "system";
          row.cancelReason = linked
            ? "Vaccine follow-up changed or no outstanding doses remain"
            : "Verified account link unavailable";
          row.slotStart = null;
          row.slotEnd = null;
          row.immunizationSlotKey = null;
          row.statusHistory.push({
            status: "cancelled",
            timestamp: now,
            changedBy: null,
            note: "Clinical schedule reconciled automatically",
          });
        }
        if (row.isModified()) await row.save({ session });
      }
    });
  } finally {
    await session.endSession();
  }
};
const scheduleBaby = async (baby, now) => {
  await reconcileRemovedVisits(baby._id, now);
  const schedule = await Schedule.findOne({
    version: baby.scheduleVersion,
    activationStatus: "active",
    effectiveOn: { $lte: todayManila(now) },
  }).lean();
  if (!schedule) return;
  const records = await Dose.find({ babyId: baby._id }).lean();
  const visits = clinicalVisits(baby, schedule, records, todayManila(now));
  const end = addDays(
    todayManila(now),
    getCategory("immunization").bookingHorizonWeeks * 7,
  );
  for (const visit of visits) {
    for (let day = visit.thursday; day <= end; day = addDays(day, 7)) {
      if (day < todayManila(now)) continue;
      const outcome = await assignVisit(baby._id, visit.targetOn, day, now);
      if (outcome !== "full") break;
    }
  }
};
const runAutomaticImmunizationAppointments = async ({
  now = new Date(),
} = {}) => {
  const result = { evaluated: 0, failed: 0 };
  for await (const baby of Baby.find({}).lean().cursor()) {
    result.evaluated++;
    try {
      await scheduleBaby(baby, now);
    } catch (error) {
      result.failed++;
      logger.error("Automatic immunization assignment failed", {
        errorName: error?.name,
      });
    }
  }
  return result;
};
module.exports = { runAutomaticImmunizationAppointments };
