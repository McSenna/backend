"use strict";

const mongoose = require("mongoose");

const BATCH_STATUSES = ["active", "depleted", "expired", "quarantined"];

/**
 * One received lot of an item.
 *
 * Stock lives here rather than on the item because a medicine is received in
 * lots that expire on different dates: releasing "20 tablets" has to mean 20
 * tablets from a specific, unexpired lot, and an expiry report has to name the
 * lot being pulled from the shelf. `InventoryItem.currentStock` is the sum of
 * the active rows here.
 */
const InventoryBatchSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true, index: true },

    batchNumber: { type: String, required: true, trim: true, maxlength: 60, index: true },

    /** As received — never decremented, so a batch's usage is auditable. */
    quantityReceived: { type: Number, required: true, min: 0 },
    /** What is still on the shelf. Guarded against ever going below zero. */
    quantityRemaining: { type: Number, required: true, min: [0, "Batch quantity cannot be negative"] },

    /** Null only for categories that do not perish (equipment). */
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

// FEFO: the release path asks for active batches of an item ordered by the
// earliest expiry, so this index is what keeps that query a scan of a few rows.
InventoryBatchSchema.index({ item: 1, status: 1, expiryDate: 1 });
// One lot number per item — a second receipt of the same lot tops it up.
InventoryBatchSchema.index({ item: 1, batchNumber: 1 }, { unique: true });

module.exports = mongoose.model("InventoryBatch", InventoryBatchSchema, "inventorybatches");
module.exports.BATCH_STATUSES = BATCH_STATUSES;
