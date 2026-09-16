"use strict";

const mongoose = require("mongoose");

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

const MedicalRecordSchema = new mongoose.Schema(
  {
    resident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true,
      index: true,
    },

    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    providerRole: {
      type: String,
      enum: ["doctor", "midwife", "bhw", "admin"],
      required: true,
    },

    serviceType: { type: String, required: true, index: true },

    assessment: { type: String, required: true, trim: true, maxlength: 4000 },
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

    completedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

MedicalRecordSchema.index({ resident: 1, completedAt: -1 });

MedicalRecordSchema.index({ serviceType: 1, completedAt: -1 });

MedicalRecordSchema.index({ provider: 1, completedAt: -1 });

MedicalRecordSchema.index({ "itemsGiven.item": 1, completedAt: -1 }, { sparse: true });

module.exports = mongoose.model("MedicalRecord", MedicalRecordSchema, "medicalrecords");
