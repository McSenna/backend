"use strict";
const Appointment = require("../../models/Appointment");
const Baby = require("../../models/Baby");
const User = require("../../models/User");
const Schedule = require("../../models/VaccineSchedule");
const Dose = require("../../models/ImmunizationDose");
const { verifiedAccountFilter } = require("./access");
const { withBookingDayLock } = require("../appointment/dayLock");
const { loadBookedOnDay } = require("./weeklySlots");
const { hasConflict } = require("../../utils/slotAvailability");
const { getCategory } = require("../../config/consultationCategories");
const { clinicalVisits, positionsOn } = require("./appointmentPlan");
const { todayManila, ageOn } = require("./calendar");
const { ageToTier } = require("../../utils/priorityQueue");
const assignVisit = (babyId, targetOn, day, now) =>
  withBookingDayLock(`immunization:${day}`, async (session) => {
    const baby = await Baby.findOneAndUpdate(
      { _id: babyId },
      { $inc: { revision: 1 } },
      { session, returnDocument: "after" },
    ).lean();
    if (!baby) return "skip";
    const user = await User.findOneAndUpdate(
      verifiedAccountFilter(baby.motherMasterResidentId),
      { $inc: { immunizationReminderFence: 1 } },
      { session, returnDocument: "after" },
    ).lean();
    const schedule = await Schedule.findOne({
      version: baby.scheduleVersion,
      activationStatus: "active",
      effectiveOn: { $lte: todayManila(now) },
    })
      .session(session)
      .lean();
    if (!user || !schedule) return "skip";
    const records = await Dose.find({ babyId }).session(session).lean();
    const visit = clinicalVisits(
      baby,
      schedule,
      records,
      todayManila(now),
    ).find((item) => item.targetOn === targetOn);
    if (!visit) return "skip";
    const activeVisit = await Appointment.exists({
      immunizationBabyId: babyId,
      status: "processing",
    }).session(session);
    if (activeVisit) return "review";
    const key = `${babyId}:${user._id}:${visit.thursday}`;
    const existing = await Appointment.findOne({
      immunizationVisitKey: key,
    }).session(session);
    const reopen =
      existing?.status === "cancelled" &&
      existing.immunizationCancellationOrigin === "system";
    if (existing && !reopen) {
      if (["confirmed", "rescheduled"].includes(existing.status)) {
        if (existing.immunizationDoseKeys.join() !== visit.doseKeys.join())
          existing.immunizationDoseKeys = visit.doseKeys;
        existing.immunizationTargetOn = visit.targetOn;
        existing.childName = baby.name;
        if (existing.isModified()) await existing.save({ session });
      }
      return "exists";
    }
    // A legacy free-text booking cannot safely be assigned to a baby by its name.
    const legacy = await Appointment.exists({
      resident: user._id,
      consultationType: "immunization",
      immunizationBabyId: null,
      status: { $in: ["pending", "confirmed", "rescheduled", "processing"] },
    }).session(session);
    if (legacy) return "review";
    if (
      targetOn < todayManila(now) &&
      !records.some((record) => record.followUpOn === targetOn)
    )
      return "review";
    const dayStart = new Date(`${day}T00:00:00+08:00`);
    const booked = await loadBookedOnDay("immunization", dayStart, session);
    const duration = getCategory("immunization").durationMinutes * 60000;
    const slotStart = positionsOn(day).find(
      (start) =>
        start > now &&
        !hasConflict(booked, start, new Date(start.getTime() + duration)),
    );
    if (!slotStart) return "full";
    const ageYears = Math.floor(
      ageOn(baby.dateOfBirth, todayManila(now)).months / 12,
    );
    const values = {
      resident: user._id,
      consultationType: "immunization",
      childName: baby.name,
      childDateOfBirth: new Date(`${baby.dateOfBirth}T00:00:00+08:00`),
      immunizationBabyId: baby._id,
      immunizationVisitKey: key,
      immunizationTargetOn: targetOn,
      immunizationDoseKeys: visit.doseKeys,
      status: "confirmed",
      ageTier: ageToTier(ageYears),
      prioritySortKey: ageToTier(ageYears),
      ageAtSubmission: ageYears,
      slotStart,
      slotEnd: new Date(slotStart.getTime() + duration),
      immunizationSlotKey: slotStart.toISOString(),
      assignedCategoryKey: "immunization",
      assignedDurationMinutes: duration / 60000,
      assignedAt: now,
      approvedAt: now,
      statusHistory: [
        {
          status: "confirmed",
          timestamp: now,
          changedBy: null,
          note: "Assigned automatically from the baby vaccine schedule",
        },
      ],
    };
    if (reopen) {
      const history = existing.statusHistory;
      existing.set({
        ...values,
        cancelReason: "",
        immunizationCancellationOrigin: null,
        statusHistory: [...history, ...values.statusHistory],
      });
      await existing.save({ session });
    } else await Appointment.create([values], { session });
    return "created";
  });
module.exports = { assignVisit };
