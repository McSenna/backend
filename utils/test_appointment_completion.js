"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const MedicalRecord = require("../models/MedicalRecord");
const Notification = require("../models/Notification");
const { COMPLETABLE_STATUSES } = require("../models/Appointment");
const ctrl = require("../controllers/medicalRecordController");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  -> " + extra : ""}`);
};

async function call(handler, { user, params = {}, body = {}, query = {} }) {
  const req = { user, params, body, query, headers: {}, socket: {} };
  let captured = { status: 200, payload: null };
  const res = {
    status(c) { captured.status = c; return this; },
    json(p) { captured.payload = p; return this; },
  };
  try {
    await handler(req, res, (e) => { if (e) throw e; });
    return { ok: true, ...captured };
  } catch (e) {
    return { ok: false, error: e, status: e.statusCode || 500, message: e.message };
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const bhw = await mongoose.connection.db.collection("users").findOne({ role: "bhw" });
  const midwife = await mongoose.connection.db.collection("users").findOne({ role: "midwife" });
  const doctor = await mongoose.connection.db.collection("users").findOne({ role: "doctor" });
  const resident = await mongoose.connection.db.collection("users").findOne({ role: "resident" });

  const asUser = (u) => ({ userId: String(u._id), role: u.role });

  const appt = await Appointment.create({
    resident: resident._id,
    consultationType: "bp_checking",
    status: "confirmed",
    ageTier: 4, prioritySortKey: 4, ageAtSubmission: 30,
    slotStart: new Date(), slotEnd: new Date(Date.now() + 5 * 60000),
    approvedAt: new Date(),
    statusHistory: [
      { status: "pending", timestamp: new Date(Date.now() - 60000), changedBy: null },
      { status: "confirmed", timestamp: new Date(), changedBy: doctor._id },
    ],
  });
  console.log(`\nTest appointment ${appt._id} (bp_checking, confirmed)\n`);

  console.log("Permissions — who may complete a BP check");
  let r = await call(ctrl.completeAppointment, {
    user: asUser(doctor), params: { id: String(appt._id) },
    body: { medicalRecord: { assessment: "x", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  ok("a doctor may not complete BP Checking", !r.ok && r.status === 403, r.message);

  r = await call(ctrl.completeAppointment, {
    user: asUser(midwife), params: { id: String(appt._id) },
    body: { medicalRecord: { assessment: "x", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  ok("a midwife may not complete BP Checking", !r.ok && r.status === 403, r.message);

  r = await call(ctrl.completeAppointment, {
    user: asUser(resident), params: { id: String(appt._id) },
    body: { medicalRecord: { assessment: "x", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  ok("a resident may not complete their own", !r.ok && r.status === 403, r.message);

  console.log("\nValidation — a record is required before completion");
  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(appt._id) }, body: { medicalRecord: {} },
  });
  ok("empty form is rejected", !r.ok && r.status === 400, r.message);
  ok("  and names every missing field", !r.ok && /Assessment.*Systolic.*Diastolic/s.test(r.message), r.message);

  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(appt._id) },
    body: { medicalRecord: { assessment: "ok", serviceDetails: { systolic: 9999, diastolic: 80 } } },
  });
  ok("out-of-range systolic is rejected", !r.ok && r.status === 400, r.message);

  const before = await MedicalRecord.countDocuments({ appointment: appt._id });
  ok("no record was written by any failed attempt", before === 0, `found ${before}`);

  console.log("\nProcessing — the optional now-serving step");
  r = await call(ctrl.startProcessing, { user: asUser(bhw), params: { id: String(appt._id) } });
  ok("BHW may start serving", r.ok, r.message);
  let fresh = await Appointment.findById(appt._id).lean();
  ok("  status is processing", fresh.status === "processing");
  ok("  processingAt was set", Boolean(fresh.processingAt));
  ok("  history recorded it", fresh.statusHistory.some((h) => h.status === "processing"));

  console.log("\nCompletion — the atomic transaction");
  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(appt._id) },
    body: {
      medicalRecord: {
        assessment: "Blood pressure within normal range.",
        recommendations: "Continue current diet.",
        followUpRequired: true, followUpDate: "2026-10-15",
        serviceDetails: { systolic: 118, diastolic: 76, pulseRate: 72, readingClassification: "normal" },
      }
    },
  });
  ok("BHW completes their own BP check", r.ok && r.status === 201, r.message);

  fresh = await Appointment.findById(appt._id).lean();
  const rec = await MedicalRecord.findOne({ appointment: appt._id }).lean();
  ok("appointment is completed", fresh.status === "completed");
  ok("completedAt set", Boolean(fresh.completedAt));
  ok("completedBy is the BHW", String(fresh.completedBy) === String(bhw._id));
  ok("appointment points at the record", String(fresh.medicalRecord) === String(rec?._id));
  ok("medical record exists", Boolean(rec));
  ok("  service details stored typed", rec?.serviceDetails?.systolic === 118 && typeof rec.serviceDetails.systolic === "number");
  ok("  follow-up preserved", rec?.followUpRequired === true && Boolean(rec.followUpDate));
  ok("  provider role recorded", rec?.providerRole === "bhw");

  console.log("\nAudit trail — approval history survives completion");
  ok("approvedAt still present", Boolean(fresh.approvedAt));
  ok("history has pending", fresh.statusHistory.some((h) => h.status === "pending"));
  ok("history has confirmed (approved)", fresh.statusHistory.some((h) => h.status === "confirmed"));
  ok("history has processing", fresh.statusHistory.some((h) => h.status === "processing"));
  ok("history has completed", fresh.statusHistory.some((h) => h.status === "completed"));
  console.log("    trail:", fresh.statusHistory.map((h) => h.status).join(" -> "));

  console.log("\nQueue removal");
  const inQueue = await Appointment.countDocuments({
    _id: appt._id, status: { $in: ["confirmed", "rescheduled", "processing"] },
  });
  ok("gone from the active queue", inQueue === 0);
  const occupies = await Appointment.countDocuments({
    _id: appt._id, status: { $in: require("../controllers/appointmentController").SLOT_OCCUPYING_STATUSES },
  });
  ok("but still holds its mission slot", occupies === 1);

  console.log("\nNotification");
  const notif = await Notification.findOne({ appointment: appt._id, type: "appointment_completed" }).lean();
  ok("resident was notified", Boolean(notif));
  ok("  addressed to the resident", String(notif?.recipient) === String(resident._id));
  ok("  carries no clinical detail", notif && !/118|76|normal range/i.test(notif.body), notif?.body);

  console.log("\nIdempotency — the double-submit guard");
  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(appt._id) },
    body: { medicalRecord: { assessment: "second attempt", serviceDetails: { systolic: 200, diastolic: 100 } } },
  });
  ok("second completion succeeds without erroring", r.ok, r.message);
  ok("  and reports it was already completed", r.payload?.alreadyCompleted === true);
  const count = await MedicalRecord.countDocuments({ appointment: appt._id });
  ok("  exactly one record exists", count === 1, `found ${count}`);
  const recheck = await MedicalRecord.findOne({ appointment: appt._id }).lean();
  ok("  the original record was not overwritten", recheck.serviceDetails.systolic === 118);

  console.log("\nCompleted list + resident history");
  r = await call(ctrl.listCompletedAppointments, { user: asUser(bhw), query: {} });
  ok("BHW sees it in Completed", r.ok && r.payload.appointments.some((a) => String(a._id) === String(appt._id)));
  ok("  and only bp_checking rows", r.ok && r.payload.appointments.every((a) => a.consultationType === "bp_checking"));

  r = await call(ctrl.listCompletedAppointments, { user: asUser(midwife), query: {} });
  ok("midwife does NOT see the BP check", r.ok && !r.payload.appointments.some((a) => String(a._id) === String(appt._id)));

  r = await call(ctrl.getMyMedicalRecords, { user: asUser(resident) });
  ok("resident sees their own record", r.ok && r.payload.medicalRecords.some((m) => String(m.appointment?._id) === String(appt._id)));
  ok("  with notes withheld", r.ok && r.payload.medicalRecords.every((m) => m.notes === undefined));

  r = await call(ctrl.getMedicalRecord, { user: asUser(midwife), params: { id: String(rec._id) } });
  ok("midwife cannot read a BP record", !r.ok && r.status === 403, r.message);
  r = await call(ctrl.getMedicalRecord, { user: asUser(resident), params: { id: String(rec._id) } });
  ok("the resident can read their own", r.ok);

  console.log("\nInvalid transitions");
  const pend = await Appointment.create({
    resident: resident._id, consultationType: "bp_checking", status: "pending",
    ageTier: 4, prioritySortKey: 4, ageAtSubmission: 30,
  });
  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(pend._id) },
    body: { medicalRecord: { assessment: "x", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  ok("a pending appointment cannot be completed", !r.ok && r.status === 409, r.message);

  const decl = await Appointment.create({
    resident: resident._id, consultationType: "bp_checking", status: "declined",
    ageTier: 4, prioritySortKey: 4, ageAtSubmission: 30,
  });
  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(decl._id) },
    body: { medicalRecord: { assessment: "x", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  ok("a declined appointment cannot be completed", !r.ok && r.status === 409, r.message);

  console.log("\nRollback — a mid-transaction failure must leave nothing behind");
  const rbAppt = await Appointment.create({
    resident: resident._id, consultationType: "bp_checking", status: "confirmed",
    ageTier: 4, prioritySortKey: 4, ageAtSubmission: 30,
    slotStart: new Date(), approvedAt: new Date(),
  });

  const realCreate = Notification.create.bind(Notification);
  Notification.create = async () => { throw new Error("simulated notification outage"); };
  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(rbAppt._id) },
    body: { medicalRecord: { assessment: "Reading taken", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  Notification.create = realCreate;

  ok("the request fails rather than half-succeeding", !r.ok);
  const afterRb = await Appointment.findById(rbAppt._id).lean();
  ok("appointment was NOT marked completed", afterRb.status === "confirmed", `status=${afterRb.status}`);
  ok("  completedAt not set", afterRb.completedAt == null);
  ok("  medicalRecord pointer not set", afterRb.medicalRecord == null);
  ok("no orphan medical record survived", (await MedicalRecord.findOne({ appointment: rbAppt._id }).lean()) === null);
  ok("no orphan notification survived", (await Notification.findOne({ appointment: rbAppt._id }).lean()) === null);
  ok("patient is STILL in the active queue", ["confirmed", "rescheduled", "processing"].includes(afterRb.status));

  r = await call(ctrl.completeAppointment, {
    user: asUser(bhw), params: { id: String(rbAppt._id) },
    body: { medicalRecord: { assessment: "Reading taken", serviceDetails: { systolic: 120, diastolic: 80 } } },
  });
  ok("and it completes normally on retry", r.ok, r.message);
  ok("  with exactly one record", (await MedicalRecord.countDocuments({ appointment: rbAppt._id })) === 1);

  await MedicalRecord.deleteMany({ appointment: { $in: [appt._id, pend._id, decl._id, rbAppt._id] } });
  await Notification.deleteMany({ appointment: { $in: [appt._id, pend._id, decl._id, rbAppt._id] } });
  await Appointment.deleteMany({ _id: { $in: [appt._id, pend._id, decl._id, rbAppt._id] } });
  console.log("\n(test data removed)");

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
