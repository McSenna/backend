"use strict";

const mongoose = require("mongoose");

const BATCH_STATUSES = ["active", "depleted", "expired", "quarantined"];

const InventoryBatchSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },

    batchNumber: { type: String, required: true, trim: true, maxlength: 60, index: true },

    quantityReceived: { type: Number, required: true, min: 0 },
    quantityRemaining: { type: Number, required: true, min: [0, "Batch quantity cannot be negative"] },

    expiryDate: { type: Date, default: null, index: true },
    receivedDate: { type: Date, default: Date.now, index: true },

    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    storageCondition: { type: String, default: "" },

    status: { type: String, enum: BATCH_STATUSES, default: "active", index: true },

    remarks: { type: String, default: "", trim: true, maxlength: 500 },

    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

InventoryBatchSchema.index({ item: 1, status: 1, expiryDate: 1 });
InventoryBatchSchema.index({ item: 1, batchNumber: 1 }, { unique: true });

module.exports = mongoose.model("InventoryBatch", InventoryBatchSchema, "inventorybatches");
module.exports.BATCH_STATUSES = BATCH_STATUSES;
