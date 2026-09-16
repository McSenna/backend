"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const MedicalRecord = require("../models/MedicalRecord");
const Notification = require("../models/Notification");
const InventoryItem = require("../models/InventoryItem");
const InventoryBatch = require("../models/InventoryBatch");
const InventoryTransaction = require("../models/InventoryTransaction");
const ctrl = require("../controllers/medicalRecordController");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  -> " + extra : ""}`);
};

async function call(handler, { user, params = {}, body = {}, query = {} }) {
  const req = { user, params, body, query, headers: {}, socket: {} };
  const captured = { status: 200, payload: null };
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

const TAG = `dispense-test-${Date.now()}`;
const made = { items: [], batches: [], appointments: [] };

async function makeItem({ name, unit, stock, category = "medicine", expiresInDays = 365 }) {
  const item = await InventoryItem.create({
    name: `${name} ${TAG}`, category, unit, reorderLevel: 5, currentStock: 0, isActive: true,
  });
  made.items.push(item._id);

  const batch = await InventoryBatch.create({
    item: item._id,
    batchNumber: `${TAG}-B1`,
    quantityReceived: stock,
    quantityRemaining: stock,
    expiryDate: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86400000),
    status: "active",
  });
  made.batches.push(batch._id);

  await InventoryItem.findByIdAndUpdate(item._id, {
    currentStock: stock,
    nearestExpiry: batch.expiryDate,
  });
  return { item: await InventoryItem.findById(item._id), batch };
}

async function makeAppointment(resident, doctor, type = "general_checkup") {
  const appt = await Appointment.create({
    resident: resident._id,
    consultationType: type,
    status: "confirmed",
    ageTier: 4, prioritySortKey: 4, ageAtSubmission: 30,
    slotStart: new Date(), slotEnd: new Date(Date.now() + 5 * 60000),
    approvedAt: new Date(),
    statusHistory: [{ status: "confirmed", timestamp: new Date(), changedBy: doctor._id }],
  });
  made.appointments.push(appt._id);
  return appt;
}

const RECORD = {
  assessment: "Seen and assessed.",
  diagnosis: "Upper respiratory infection",
  serviceDetails: { chiefComplaint: "Cough and fever" },
};
const stockOf = async (id) => (await InventoryItem.findById(id).lean()).currentStock;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const doctor = await mongoose.connection.db.collection("users").findOne({ role: "doctor" });
  const bhw = await mongoose.connection.db.collection("users").findOne({ role: "bhw" });
  const resident = await mongoose.connection.db.collection("users").findOne({ role: "resident" });
  if (!doctor || !resident || !bhw) {
    console.log("Need a doctor, a BHW and a resident in the database. Aborting.");
    process.exit(1);
  }
  const asUser = (u) => ({ userId: String(u._id), role: u.role });

  console.log(`\nDispensing tests  (tag ${TAG})\n`);

  console.log("A visit that dispensed nothing");
  {
    const appt = await makeAppointment(resident, doctor);
    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) }, body: { medicalRecord: RECORD },
    });
    ok("completes normally with no inventory", r.ok && r.status === 201, r.message);
    const rec = await MedicalRecord.findOne({ appointment: appt._id }).lean();
    ok("  record has an empty itemsGiven", Array.isArray(rec.itemsGiven) && rec.itemsGiven.length === 0);
    const ledger = await InventoryTransaction.countDocuments({ relatedAppointment: appt._id });
    ok("  no ledger rows were written", ledger === 0, `found ${ledger}`);
  }

  console.log("\nOne item");
  {
    const { item } = await makeItem({ name: "Paracetamol 500mg", unit: "tablets", stock: 100 });
    const appt = await makeAppointment(resident, doctor);

    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 10 }] },
    });
    ok("completes with one item", r.ok && r.status === 201, r.message);
    ok("  stock deducted 100 -> 90", (await stockOf(item._id)) === 90, String(await stockOf(item._id)));

    const rec = await MedicalRecord.findOne({ appointment: appt._id }).lean();
    ok("  record stores the line", rec.itemsGiven.length === 1);
    ok("  quantity is right", rec.itemsGiven[0]?.quantity === 10);
    ok("  name snapshotted", rec.itemsGiven[0]?.itemName?.includes("Paracetamol"));
    ok("  unit snapshotted", rec.itemsGiven[0]?.unit === "tablets");
    ok("  batch snapshotted", rec.itemsGiven[0]?.batchNumbers?.length === 1);

    const led = await InventoryTransaction.find({ relatedAppointment: appt._id }).lean();
    ok("  one ledger row", led.length === 1);
    ok("    type STOCK_OUT", led[0]?.type === "STOCK_OUT");
    ok("    before/after recorded", led[0]?.previousStock === 100 && led[0]?.newStock === 90);
    ok("    linked to the patient", String(led[0]?.relatedPatient) === String(resident._id));
    ok("    linked to the record", String(led[0]?.relatedMedicalRecord) === String(rec._id));
    ok("    performed by the doctor", String(led[0]?.performedBy) === String(doctor._id));
    ok("  response reports the movement", r.payload?.inventoryTransactions?.length === 1);
    ok("    with authoritative figures", r.payload?.inventoryTransactions?.[0]?.newStock === 90);
  }

  console.log("\nMultiple items");
  {
    const a = await makeItem({ name: "Vitamin C", unit: "tablets", stock: 60 });
    const b = await makeItem({ name: "Tetanus Vaccine", unit: "doses", stock: 12, category: "vaccine" });
    const appt = await makeAppointment(resident, doctor);

    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: {
        medicalRecord: RECORD, inventoryItems: [
          { inventoryItemId: String(a.item._id), quantity: 5 },
          { inventoryItemId: String(b.item._id), quantity: 1 },
        ]
      },
    });
    ok("completes with two items", r.ok && r.status === 201, r.message);
    ok("  first deducted", (await stockOf(a.item._id)) === 55);
    ok("  second deducted", (await stockOf(b.item._id)) === 11);
    const rec = await MedicalRecord.findOne({ appointment: appt._id }).lean();
    ok("  both lines on the record", rec.itemsGiven.length === 2);
  }

  console.log("\nThe same item sent twice");
  {
    const { item } = await makeItem({ name: "Amoxicillin", unit: "capsules", stock: 50 });
    const appt = await makeAppointment(resident, doctor);
    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: {
        medicalRecord: RECORD, inventoryItems: [
          { inventoryItemId: String(item._id), quantity: 2 },
          { inventoryItemId: String(item._id), quantity: 3 },
        ]
      },
    });
    ok("accepted", r.ok, r.message);
    const rec = await MedicalRecord.findOne({ appointment: appt._id }).lean();
    ok("  merged into one line", rec.itemsGiven.length === 1);
    ok("  quantities summed to 5", rec.itemsGiven[0]?.quantity === 5);
    ok("  stock deducted once, by 5", (await stockOf(item._id)) === 45);
  }

  console.log("\nInsufficient stock");
  {
    const { item } = await makeItem({ name: "Cetirizine", unit: "tablets", stock: 3 });
    const appt = await makeAppointment(resident, doctor);
    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 5 }] },
    });
    ok("the completion is refused", !r.ok && r.status === 409, `${r.status} ${r.message}`);
    ok("  the message names what is left", /3/.test(r.message || ""), r.message);
    ok("  stock untouched", (await stockOf(item._id)) === 3);
    const fresh = await Appointment.findById(appt._id).lean();
    ok("  appointment NOT completed", fresh.status !== "completed", fresh.status);
    ok("  patient still in the queue", ["confirmed", "rescheduled", "processing"].includes(fresh.status));
    ok("  no medical record written", (await MedicalRecord.countDocuments({ appointment: appt._id })) === 0);
    ok("  no ledger rows written", (await InventoryTransaction.countDocuments({ relatedAppointment: appt._id })) === 0);
  }

  console.log("\nExpired stock");
  {
    const item = await InventoryItem.create({
      name: `Expired Syrup ${TAG}`, category: "medicine", unit: "bottles",
      reorderLevel: 1, currentStock: 20, isActive: true,
    });
    made.items.push(item._id);
    const batch = await InventoryBatch.create({
      item: item._id, batchNumber: `${TAG}-EXP`, quantityReceived: 20, quantityRemaining: 20,
      expiryDate: new Date(Date.now() - 10 * 86400000), status: "active",
    });
    made.batches.push(batch._id);

    const appt = await makeAppointment(resident, doctor);
    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 1 }] },
    });
    ok("expired stock cannot be dispensed", !r.ok && r.status === 409, `${r.status} ${r.message}`);
    const fresh = await Appointment.findById(appt._id).lean();
    ok("  appointment NOT completed", fresh.status !== "completed");
    ok("  stock untouched", (await stockOf(item._id)) === 20, String(await stockOf(item._id)));
    const { expireLapsedBatches } = require("../services/inventoryService");
    await expireLapsedBatches(item._id);
    const b = await InventoryBatch.findById(batch._id).lean();
    ok("  a normal read marks the lapsed lot expired", b.status === "expired", b.status);
  }

  console.log("\nArchived and invalid items");
  {
    const { item } = await makeItem({ name: "Archived Item", unit: "pcs", stock: 10 });
    await InventoryItem.findByIdAndUpdate(item._id, { isActive: false });
    const appt = await makeAppointment(resident, doctor);
    let r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 1 }] },
    });
    ok("an archived item is refused", !r.ok && r.status === 404, `${r.status} ${r.message}`);

    r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: "not-an-id", quantity: 1 }] },
    });
    ok("a malformed id is refused", !r.ok && r.status === 400, `${r.status} ${r.message}`);

    r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 0 }] },
    });
    ok("a zero quantity is refused", !r.ok && r.status === 400, `${r.status} ${r.message}`);

    r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: -4 }] },
    });
    ok("a negative quantity is refused", !r.ok && r.status === 400, `${r.status} ${r.message}`);

    const fresh = await Appointment.findById(appt._id).lean();
    ok("  none of it completed the visit", fresh.status !== "completed");
  }

  console.log("\nDouble submission");
  {
    const { item } = await makeItem({ name: "Ibuprofen", unit: "tablets", stock: 40 });
    const appt = await makeAppointment(resident, doctor);
    const body = {
      medicalRecord: RECORD,
      inventoryItems: [{ inventoryItemId: String(item._id), quantity: 4 }],
    };

    const first = await call(ctrl.completeAppointment, { user: asUser(doctor), params: { id: String(appt._id) }, body });
    ok("first submit completes", first.ok && first.status === 201, first.message);

    const second = await call(ctrl.completeAppointment, { user: asUser(doctor), params: { id: String(appt._id) }, body });
    ok("second submit is not an error", second.ok, second.message);
    ok("  and reports already completed", second.payload?.alreadyCompleted === true);
    ok("  stock deducted exactly once", (await stockOf(item._id)) === 36, String(await stockOf(item._id)));
    ok("  one ledger row only", (await InventoryTransaction.countDocuments({ relatedAppointment: appt._id })) === 1);
    ok("  one record only", (await MedicalRecord.countDocuments({ appointment: appt._id })) === 1);
  }

  console.log("\nTwo health workers racing for the last units");
  {
    const { item } = await makeItem({ name: "Last Units", unit: "vials", stock: 5 });
    const apptA = await makeAppointment(resident, doctor);
    const apptB = await makeAppointment(resident, doctor);

    const results = await Promise.all([
      call(ctrl.completeAppointment, {
        user: asUser(doctor), params: { id: String(apptA._id) },
        body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 4 }] },
      }),
      call(ctrl.completeAppointment, {
        user: asUser(doctor), params: { id: String(apptB._id) },
        body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 4 }] },
      }),
    ]);

    const winners = results.filter((r) => r.ok && r.status === 201).length;
    ok("exactly one of the two succeeded", winners === 1, `${winners} succeeded`);
    const left = await stockOf(item._id);
    ok("  stock never went negative", left >= 0, String(left));
    ok("  and exactly one deduction landed", left === 1, String(left));

    const completed = await Appointment.countDocuments({
      _id: { $in: [apptA._id, apptB._id] }, status: "completed",
    });
    ok("  only the winner's visit completed", completed === 1, String(completed));
  }

  console.log("\nRollback — a failure after the deduction must give the stock back");
  {
    const { item } = await makeItem({ name: "Rollback Item", unit: "tablets", stock: 30 });
    const appt = await makeAppointment(resident, doctor);

    const realCreate = Notification.create.bind(Notification);
    Notification.create = async () => { throw new Error("forced notification failure"); };

    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 7 }] },
    });
    Notification.create = realCreate;

    ok("the request failed", !r.ok, "it unexpectedly succeeded");
    ok("  stock was restored to 30", (await stockOf(item._id)) === 30, String(await stockOf(item._id)));
    const batch = await InventoryBatch.findOne({ item: item._id }).lean();
    ok("  the batch was restored too", batch.quantityRemaining === 30, String(batch.quantityRemaining));
    ok("  no ledger row survived", (await InventoryTransaction.countDocuments({ relatedAppointment: appt._id })) === 0);
    ok("  no medical record survived", (await MedicalRecord.countDocuments({ appointment: appt._id })) === 0);
    const fresh = await Appointment.findById(appt._id).lean();
    ok("  appointment NOT completed", fresh.status !== "completed");
    ok("  patient still in the queue", ["confirmed", "rescheduled", "processing"].includes(fresh.status));

    const retry = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 7 }] },
    });
    ok("  and it completes on retry", retry.ok && retry.status === 201, retry.message);
    ok("    deducting exactly once", (await stockOf(item._id)) === 23, String(await stockOf(item._id)));
  }

  console.log("\nFEFO across lots");
  {
    const item = await InventoryItem.create({
      name: `Two Lot Item ${TAG}`, category: "medicine", unit: "tablets",
      reorderLevel: 1, currentStock: 0, isActive: true,
    });
    made.items.push(item._id);
    const soon = await InventoryBatch.create({
      item: item._id, batchNumber: `${TAG}-SOON`, quantityReceived: 4, quantityRemaining: 4,
      expiryDate: new Date(Date.now() + 10 * 86400000), status: "active",
    });
    const later = await InventoryBatch.create({
      item: item._id, batchNumber: `${TAG}-LATER`, quantityReceived: 20, quantityRemaining: 20,
      expiryDate: new Date(Date.now() + 300 * 86400000), status: "active",
    });
    made.batches.push(soon._id, later._id);
    await InventoryItem.findByIdAndUpdate(item._id, { currentStock: 24 });

    const appt = await makeAppointment(resident, doctor);
    const r = await call(ctrl.completeAppointment, {
      user: asUser(doctor), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 6 }] },
    });
    ok("a dispense spanning two lots succeeds", r.ok, r.message);
    const s1 = await InventoryBatch.findById(soon._id).lean();
    const s2 = await InventoryBatch.findById(later._id).lean();
    ok("  the sooner-expiring lot emptied first", s1.quantityRemaining === 0, String(s1.quantityRemaining));
    ok("    and was marked depleted", s1.status === "depleted", s1.status);
    ok("  the remainder came from the later lot", s2.quantityRemaining === 18, String(s2.quantityRemaining));
    const rec = await MedicalRecord.findOne({ appointment: appt._id }).lean();
    ok("  the record names both lots", rec.itemsGiven[0]?.batchNumbers?.length === 2);
    ok("  one ledger row per lot", (await InventoryTransaction.countDocuments({ relatedAppointment: appt._id })) === 2);
  }

  console.log("\nRole and service rules still hold");
  {
    const { item } = await makeItem({ name: "Role Guard", unit: "tablets", stock: 10 });
    const appt = await makeAppointment(resident, doctor, "general_checkup");
    const r = await call(ctrl.completeAppointment, {
      user: asUser(bhw), params: { id: String(appt._id) },
      body: { medicalRecord: RECORD, inventoryItems: [{ inventoryItemId: String(item._id), quantity: 1 }] },
    });
    ok("a BHW cannot complete a General Checkup", !r.ok && r.status === 403, `${r.status} ${r.message}`);
    ok("  and no stock moved", (await stockOf(item._id)) === 10);
  }

  const recordIds = await MedicalRecord.find({ appointment: { $in: made.appointments } }).distinct("_id");
  await InventoryTransaction.deleteMany({ relatedAppointment: { $in: made.appointments } });
  await MedicalRecord.deleteMany({ appointment: { $in: made.appointments } });
  await Notification.deleteMany({ appointment: { $in: made.appointments } });
  await Appointment.deleteMany({ _id: { $in: made.appointments } });
  await InventoryBatch.deleteMany({ item: { $in: made.items } });
  await InventoryTransaction.deleteMany({ item: { $in: made.items } });
  await InventoryItem.deleteMany({ _id: { $in: made.items } });
  console.log(`\n(test data removed: ${made.appointments.length} appointments, ${made.items.length} items, ${recordIds.length} records)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("\nTest harness error:", e);
  await mongoose.disconnect().catch(() => { });
  process.exit(1);
});
