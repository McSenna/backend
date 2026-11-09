"use strict";

const mongoose = require("mongoose");
const { RETURN_CONDITIONS, MOVEMENT_RELATIONS } = require("../config/inventoryMovements");

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

const text = (maxlength) => ({ type: String, default: "", trim: true, maxlength });

const InventoryTransactionSchema = new mongoose.Schema(
  {
    reference: { type: String, trim: true },

    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryBatch", default: null, index: true },
    batchNumber: { type: String, default: "", trim: true },

    // Copied at write time so a renamed or deactivated item keeps its history as it happened.
    itemName: text(160),
    itemSpecification: text(120),
    itemCode: text(32),
    itemCategory: text(24),
    itemUnit: text(24),

    type: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },
    status: { type: String, enum: ["completed", "issued"], default: "completed" },

    quantity: { type: Number, required: true, min: [1, "Quantity must be at least 1"] },

    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true, min: 0 },

    reason: { type: String, default: "", trim: true, maxlength: 300 },
    source: { type: String, default: "", trim: true, maxlength: 200 },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },
    referenceNumber: text(80),

    destinationName: text(200),
    destinationDepartment: text(120),
    destinationLocation: text(200),

    recipient: { type: String, default: "", trim: true, maxlength: 200 },
    recipientDesignation: text(120),
    recipientDepartment: text(120),

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required() {
        return !this.recordedBySystem;
      },
    },
    performedByName: text(160),
    performedByRole: { type: String, default: "" },
    recordedBySystem: { type: Boolean, default: false },

    relatedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction", default: null },
    relation: { type: String, enum: [...MOVEMENT_RELATIONS, null], default: null },
    returnCondition: { type: String, enum: [...RETURN_CONDITIONS, null], default: null },

    // One id per submitted form: a retry of the same form replays instead of moving stock twice.
    operationId: { type: String, default: undefined },
    operationLine: { type: Number, default: undefined },

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
InventoryTransactionSchema.index({ createdAt: -1, _id: -1 });
InventoryTransactionSchema.index({ itemCategory: 1, createdAt: -1 });
InventoryTransactionSchema.index({ performedBy: 1, createdAt: -1 });
InventoryTransactionSchema.index({ relatedTransaction: 1, relation: 1 });

InventoryTransactionSchema.index({ relatedAppointment: 1, createdAt: -1 }, { sparse: true });
InventoryTransactionSchema.index({ relatedPatient: 1, createdAt: -1 }, { sparse: true });

InventoryTransactionSchema.index({ reference: 1 }, { unique: true, sparse: true });
InventoryTransactionSchema.index(
  { operationId: 1, operationLine: 1 },
  { unique: true, partialFilterExpression: { operationId: { $type: "string" } } }
);
// A movement can be reversed once, even if two people press Reverse together.
InventoryTransactionSchema.index(
  { relation: 1, relatedTransaction: 1 },
  { unique: true, partialFilterExpression: { relation: "reversal" } }
);

const refuseChange = () => {
  throw new Error("Inventory movements are permanent. Record a return or a reversal instead.");
};

InventoryTransactionSchema.pre(
  ["updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "deleteOne", "deleteMany"],
  { query: true, document: false },
  refuseChange
);
InventoryTransactionSchema.pre("deleteOne", { document: true, query: false }, refuseChange);
InventoryTransactionSchema.pre("bulkWrite", refuseChange);
InventoryTransactionSchema.pre("save", function refuseResave() {
  if (!this.isNew) refuseChange();
});

// The last characters of the ObjectId keep the reference short and need no shared counter.
const manilaYear = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" });
const movementReference = (id, createdAt = new Date()) =>
  `MV-${manilaYear.format(createdAt)}-${String(id).slice(-8).toUpperCase()}`;

module.exports = mongoose.model(
  "InventoryTransaction",
  InventoryTransactionSchema,
  "inventorytransactions"
);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
module.exports.INCREASING_TYPES = INCREASING_TYPES;
module.exports.TRANSACTION_TYPE_LABELS = TRANSACTION_TYPE_LABELS;
module.exports.movementReference = movementReference;
