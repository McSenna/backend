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

/** Types that raise the stock level; everything else lowers it. */
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

/**
 * The stock ledger.
 *
 * Every movement writes one row here, including the before and after figures,
 * so the current stock can always be reconciled against the ledger and no
 * quantity can change without a trace. Rows are never edited or deleted.
 */
const InventoryTransactionSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryBatch", default: null, index: true },
    batchNumber: { type: String, default: "", trim: true },

    type: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },

    /** Always positive; `type` carries the direction. */
    quantity: { type: Number, required: true, min: [1, "Quantity must be at least 1"] },

    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true, min: 0 },

    reason: { type: String, default: "", trim: true, maxlength: 300 },
    /** Where stock came from, for receipts. */
    source: { type: String, default: "", trim: true, maxlength: 200 },
    /** Who or which department it went to, for releases. */
    recipient: { type: String, default: "", trim: true, maxlength: 200 },
    notes: { type: String, default: "", trim: true, maxlength: 1000 },

    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    performedByRole: { type: String, default: "" },

    /**
     * Optional clinical links. Only the identifiers are held — no diagnosis or
     * other patient detail belongs in a stock ledger.
     */
    relatedPatient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    relatedAppointment: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
  },
  { timestamps: true }
);

// The item history view: newest first, for one item.
InventoryTransactionSchema.index({ item: 1, createdAt: -1 });
// Stock movement reports over a date range.
InventoryTransactionSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model(
  "InventoryTransaction",
  InventoryTransactionSchema,
  "inventorytransactions"
);
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
module.exports.INCREASING_TYPES = INCREASING_TYPES;
module.exports.TRANSACTION_TYPE_LABELS = TRANSACTION_TYPE_LABELS;
