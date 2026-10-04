"use strict";

const mongoose = require("mongoose");
const { isAppointmentSource } = require("../config/medicalRecordSources");
const { encodedFields, STAFF_ROLES } = require("./medicalRecord/encodedFields");

// Appointment records always have an account, an appointment and a provider
// account. Encoded records (see medicalRecord/encodedFields.js) may have none.
function fromAppointment() {
  return isAppointmentSource(this.source);
}

const DispensedItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },

    itemName: { type: String, required: true, trim: true, maxlength: 160 },
    specification: { type: String, default: "", trim: true, maxlength: 120 },
    category: { type: String, default: "", trim: true, maxlength: 40 },
    unit: { type: String, required: true, trim: true, maxlength: 24 },

    quantity: { type: Number, required: true, min: [1, "Quantity must be at least 1"] },

    batchNumbers: { type: [String], default: () => [] },
    expiryDate: { type: Date, default: null },

    transactions: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction" }],
      default: () => [],
    },
  },
  { _id: false }
);

const APPOINTMENT_INDEX_NAME = "appointment_unique_when_set";

const MedicalRecordSchema = new mongoose.Schema(
  {
    resident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: fromAppointment,
      index: true,
    },

    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: fromAppointment,
    },

    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: fromAppointment,
      index: true,
    },

    providerRole: {
      type: String,
      enum: [...STAFF_ROLES, null],
      required: fromAppointment,
    },

    serviceType: { type: String, required: true, index: true },

    // Paper records often carry only readings, so only appointments require it.
    assessment: { type: String, required: fromAppointment, default: "", trim: true, maxlength: 4000 },
    findings: { type: String, default: "", trim: true, maxlength: 4000 },
    diagnosis: { type: String, default: "", trim: true, maxlength: 500 },
    recommendations: { type: String, default: "", trim: true, maxlength: 4000 },

    notes: { type: String, default: "", trim: true, maxlength: 4000 },

    serviceDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },

    itemsGiven: { type: [DispensedItemSchema], default: () => [] },

    followUpRequired: { type: Boolean, default: false, index: true },
    followUpDate: { type: Date, default: null },

    appointmentDate: { type: Date, default: null },

    // Date of care. For encoded records this is the visit date at UTC midnight.
    completedAt: { type: Date, required: true, index: true },

    ...encodedFields,
  },
  { timestamps: true }
);

// One record per appointment. Partial, so encoded records (no appointment) never
// collide on a missing key. scripts/migrations/medicalRecordSource.js swaps the
// old non-partial index for this one.
MedicalRecordSchema.index(
  { appointment: 1 },
  {
    unique: true,
    name: APPOINTMENT_INDEX_NAME,
    // $exists (not $type) so a plain `{ appointment: id }` lookup can use it.
    partialFilterExpression: { appointment: { $exists: true } },
  }
);

MedicalRecordSchema.index(
  { createdBy: 1, requestKey: 1 },
  { unique: true, partialFilterExpression: { requestKey: { $type: "string" } } }
);

MedicalRecordSchema.index({ masterResidentId: 1, completedAt: -1 });

MedicalRecordSchema.index({ source: 1, completedAt: -1 });

MedicalRecordSchema.index({ resident: 1, completedAt: -1 });

MedicalRecordSchema.index({ serviceType: 1, completedAt: -1 });

MedicalRecordSchema.index({ provider: 1, completedAt: -1 });

MedicalRecordSchema.index({ "itemsGiven.item": 1, completedAt: -1 }, { sparse: true });

module.exports = mongoose.model("MedicalRecord", MedicalRecordSchema, "medicalrecords");
module.exports.APPOINTMENT_INDEX_NAME = APPOINTMENT_INDEX_NAME;
