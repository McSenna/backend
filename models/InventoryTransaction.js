"use strict";

const mongoose = require("mongoose");

const TRANSACTION_TYPES = [
  "STOCK_IN",
  "STOCK_OUT",
  "ADJUSTMENT",
  "EXPIRED",
  "DAMAGED",
  "RETURNED",
  "TRANSFER",
];

const INCREASING_TYPES = ["STOCK_IN", "RETURNED"];

const TRANSACTION_TYPE_LABELS = {
  STOCK_IN: "Stock In",
  STOCK_OUT: "Stock Out",
  ADJUSTMENT: "Adjustment",
  EXPIRED: "Expired",
  DAMAGED: "Damaged",
  RETURNED: "Returned",
  TRANSFER: "Transfer",
};

const InventoryTransactionSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryBatch", default: null, index: true },
    batchNumber: { type: String, default: "", trim: true },

    type: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },

    quantity: { type: Number, required: true, min: [1, "Quantity must be at least 1"] },

    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true, min: 0 },

    reason: { type: String, default: "", trim: true, maxlength: 300 },
    source: { type: String, default: "", trim: true, maxlength: 200 },
    recipient: { type: String, default: "", trim: true, maxlength: 200 },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    performedByRole: { type: String, default: "" },

    relatedPatient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    relatedAppointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },

    relatedMedicalRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicalRecord",
      default: null,
    },
  },
  { timestamps: true }
);

InventoryTransactionSchema.index({ item: 1, createdAt: -1 });
InventoryTransactionSchema.index({ type: 1, createdAt: -1 });

InventoryTransactionSchema.index({ relatedAppointment: 1, createdAt: -1 }, { sparse: true });
InventoryTransactionSchema.index({ relatedPatient: 1, createdAt: -1 }, { sparse: true });

module.exports = mongoose.model(
  "InventoryTransaction",
  InventoryTransactionSchema,
  "inventorytransactions"
);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
module.exports.INCREASING_TYPES = INCREASING_TYPES;
module.exports.TRANSACTION_TYPE_LABELS = TRANSACTION_TYPE_LABELS;
