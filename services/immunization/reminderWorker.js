"use strict";
const mongoose = require("mongoose");
const Baby = require("../../models/Baby");
const Dose = require("../../models/ImmunizationDose");
const Schedule = require("../../models/VaccineSchedule");
const User = require("../../models/User");
const Reminder = require("../../models/ImmunizationReminder");
const Notification = require("../../models/Notification");
const Appointment = require("../../models/Appointment");
const {withAssignedVisits} = require('./appointmentPlan');
const { todayManila } = require("./calendar");
const { buildDoseViews } = require("./checklist");
const { planReminderVisits } = require("./reminderPlanner");
const logger = require("../../utils/logger");

const verifiedRecipientFilter = (masterResidentId) => ({
  masterResidentId, role: "resident", status: { $in: ["approved", "active"] }, verified: true,
  verificationMethod: { $in: ["master_list", "admin_review"] },
  immunizationRemindersEnabled: { $ne: false },
});
const retryAt = (now, attempts) => new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)));

async function reconcileBaby(babyId, now) {
  let deliveringKey = null;
  let deliveringVisit = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      deliveringKey = null;
      // All clinical writers touch this document. Concurrent completion/follow-up
      // causes a transaction retry and fresh scheduling, never stale delivery.
      const baby = await Baby.findOneAndUpdate({ _id: babyId }, { $inc: { revision: 1 } }, { session, returnDocument: "after" }).lean();
      if (!baby) return;
      const user = await User.findOneAndUpdate(verifiedRecipientFilter(baby.motherMasterResidentId), { $inc: { immunizationReminderFence: 1 } }, { session, returnDocument: "after" }).lean();
      const schedule = await Schedule.findOne({ version: baby.scheduleVersion, activationStatus: "active", effectiveOn: { $lte: todayManila(now) } }).session(session).lean();
      const records = await Dose.find({ babyId }).session(session).lean();
      const appointments = await Appointment.find({immunizationBabyId:babyId,resident:user?._id}).session(session).lean();
      const doses = user && schedule ? withAssignedVisits(buildDoseViews(baby, schedule, records, todayManila(now)),appointments,todayManila(now),schedule.dueWindowDays).filter(dose=>dose.appointmentId || schedule.slots.find(slot=>slot.key===dose.slot)?.days===0) : [];
      const deliveredOverdue = await Reminder.find({babyId,recipient:user?._id,stage:"overdue",deliveredAt:{$ne:null}}).sort({deliveredAt:1}).session(session).lean();
      const visits = user && schedule ? planReminderVisits(doses, todayManila(now), schedule.reminderDays, schedule.dueWindowDays, deliveredOverdue) : [];
      const keys = visits.map(visit => `${babyId}:${user._id}:${visit.visitKey}:${visit.stage}`);
      await Reminder.updateMany({ babyId, dedupeKey: { $nin: keys }, status: { $ne: "cancelled" } }, { $set: { status: "cancelled" } }, { session });
      for (const visit of visits) {
        const dedupeKey = `${babyId}:${user._id}:${visit.visitKey}:${visit.stage}`;
        let reminder = await Reminder.findOneAndUpdate({ dedupeKey }, {
          $setOnInsert: { babyId, recipient: user._id, ...visit, dedupeKey, status: "pending", attempts: 0 },
        }, { upsert: true, returnDocument: "after", session }).lean();
        if (reminder.deliveredAt || reminder.status === "delivered") {
          const selected = doses.filter(dose => visit.doseKeys.includes(dose.key));
          const vaccines = selected.map(dose => ({key:dose.key,name:schedule.vaccines.find(v => v.key === dose.vaccineKey)?.name || dose.label,label:dose.label}));
          await Reminder.updateOne({_id:reminder._id},{$set:{status:"delivered",scheduledOn:visit.scheduledOn,doseKeys:visit.doseKeys}},{session});
          await Notification.updateOne({dedupeKey},{$set:{immunizationDetail:{babyName:baby.name,scheduledOn:visit.scheduledOn,vaccines}}},{session});
          continue;
        }
        if (reminder.nextAttemptAt && reminder.nextAttemptAt > now) continue;
        deliveringKey = dedupeKey;
        deliveringVisit = visit;
        await Reminder.updateOne({ _id: reminder._id }, { $set: { status: "pending", scheduledOn: visit.scheduledOn, doseKeys: visit.doseKeys, doseVisits: visit.doseVisits || [] } }, { session });
        const selected = doses.filter(dose => visit.doseKeys.includes(dose.key));
        const vaccines = selected.map(dose => ({ key: dose.key, name: schedule.vaccines.find(v => v.key === dose.vaccineKey)?.name || dose.label, label: dose.label }));
        // Unique upsert plus the persisted delivery record makes repeated workers
        // and retries safe. The notice and delivered state commit atomically.
        await Notification.updateOne({ dedupeKey }, { $setOnInsert: {
          dedupeKey, recipient: user._id, type: "immunization_reminder",
          title: "Immunization reminder", body: "You have an immunization update. Open your secure inbox for details.",
          tone: visit.stage === "overdue" ? "warning" : "info",
          immunizationBabyId: babyId, immunizationReminderId: reminder._id,
          immunizationDetail: { babyName: baby.name, scheduledOn: visit.scheduledOn, vaccines },
        } }, { upsert: true, session });
        await Reminder.updateOne({ _id: reminder._id }, { $set: { status: "delivered", deliveredAt: now, lastError: "", nextAttemptAt: null }, $inc: { attempts: 1 }, $push: { attemptHistory: { at: now, outcome: "delivered" } } }, { session });
        deliveringKey = null;
      }
    });
  } catch (error) {
    // The transaction rollback also undoes queue insertion. Preserve the current
    // attempt outside it so a temporary storage failure gets durable backoff.
    if (deliveringKey) {
      const parts = deliveringKey.split(":");
      const reminder = await Reminder.findOneAndUpdate({ dedupeKey: deliveringKey }, {
        $setOnInsert: { babyId, recipient: parts[1], visitKey: deliveringVisit.visitKey, scheduledOn: deliveringVisit.scheduledOn, stage: deliveringVisit.stage, doseKeys: deliveringVisit.doseKeys, doseVisits: deliveringVisit.doseVisits || [], dedupeKey: deliveringKey },
        $set: { status: "pending", lastError: "delivery_failed" }, $inc: { attempts: 1 },
        $push: { attemptHistory: { at: now, outcome: "failed", errorCode: "delivery_failed" } },
      }, { upsert: true, returnDocument: "after" }).lean();
      await Reminder.updateOne({ _id: reminder._id, status: "pending" }, { $set: { nextAttemptAt: retryAt(now, reminder.attempts) } });
    }
    throw error;
  } finally { await session.endSession(); }
}

async function runImmunizationReminders({ now = new Date() } = {}) {
  const assignments = await require('./automaticAppointments').runAutomaticImmunizationAppointments({now});
  const result = { evaluated: 0, failed: assignments.failed };
  const cursor = Baby.find({}).select("_id").lean().cursor();
  for await (const baby of cursor) {
    result.evaluated += 1;
    try { await reconcileBaby(baby._id, now); }
    catch (error) {
      result.failed += 1;
      logger.error("Immunization reminder evaluation failed", { errorName: error?.name });
    }
  }
  return result;
}

function startImmunizationReminderScheduler({ intervalMs = Number(process.env.IMMUNIZATION_REMINDER_INTERVAL_MS || 900000) } = {}) {
  if (process.env.IMMUNIZATION_REMINDERS_DISABLED === "true") return () => {};
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error("Invalid immunization reminder interval");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runImmunizationReminders(); }
    catch (error) { logger.error("Immunization reminder job failed", { errorName: error?.name }); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
// Invalidation also hides protected details on already delivered notices; the
// retained deliveredAt preserves dedupe if a follow-up later moves back.
async function cancelPendingForBaby(babyId, session) {
  return Reminder.updateMany({ babyId, status: { $ne: "cancelled" } }, { $set: { status: "cancelled" } }, { session });
}
async function cancelPendingForRecipient(recipient, session) {
  return Reminder.updateMany({ recipient, status: { $ne: "cancelled" } }, { $set: { status: "cancelled" } }, { session });
}
module.exports = { runImmunizationReminders, startImmunizationReminderScheduler, verifiedRecipientFilter, cancelPendingForBaby, cancelPendingForRecipient };
