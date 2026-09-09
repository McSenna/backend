"use strict";

const mongoose = require("mongoose");

const INVENTORY_CATEGORIES = ["medicine", "vaccine", "supply", "equipment", "maternal", "other"];

const CATEGORY_LABELS = {
  medicine: "Medicine",
  vaccine: "Vaccine",
  supply: "Supply",
  equipment: "Equipment",
  maternal: "Maternal Health",
  other: "Other",
};

/**
 * Categories whose stock carries an expiry date.
 *
 * Equipment is durable and a BP monitor has no shelf life, so an expiry filter
 * that lumped it in with vaccines would report a permanent "No Expiry" backlog.
 * Used to decide whether a batch may be received without an expiry date.
 */
const PERISHABLE_CATEGORIES = ["medicine", "vaccine", "maternal", "supply"];

const STORAGE_CONDITIONS = ["room-temperature", "refrigerated", "frozen", "dry-storage", "controlled"];

const STORAGE_CONDITION_LABELS = {
  "room-temperature": "Room Temperature",
  refrigerated: "Refrigerated (2°C – 8°C)",
  frozen: "Frozen",
  "dry-storage": "Dry Storage",
  controlled: "Controlled Substance Storage",
};

const InventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Item name is required"], trim: true, maxlength: 160 },
    /** Dosage or specification — "Tablet", "0.5 mL (Adult)", "Box (100 pcs)". */
    specification: { type: String, default: "", trim: true, maxlength: 120 },
    genericName: { type: String, default: "", trim: true, maxlength: 160 },
    description: { type: String, default: "", trim: true, maxlength: 1000 },

    category: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      enum: { values: INVENTORY_CATEGORIES, message: "Unsupported inventory category" },
      index: true,
    },

    /** Dispensing unit as it is written on the shelf: tabs, vials, pcs, boxes. */
    unit: { type: String, required: [true, "Unit is required"], trim: true, maxlength: 24 },

    reorderLevel: { type: Number, required: true, min: [0, "Reorder level cannot be negative"], default: 0 },

    storageCondition: {
      type: String,
      enum: STORAGE_CONDITIONS,
      default: "room-temperature",
    },

    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null, index: true },

    /**
     * Sum of every active batch's remaining quantity.
     *
     * A cache, not the source of truth: batches hold the real figures and every
     * write that moves stock updates both inside the same guarded operation.
     * Denormalised because the list view sorts and filters on stock level, and
     * an aggregation over batches per row would not survive server-side
     * pagination. `recalculateItemStock` in the service rebuilds it from the
     * batches whenever the two could have drifted.
     */
    currentStock: { type: Number, default: 0, min: 0, index: true },

    /** Nearest expiry among active, non-expired batches — drives the list column. */
    nearestExpiry: { type: Date, default: null, index: true },

    lastRestockedAt: { type: Date, default: null },

    /** Soft delete: an item with transaction history is deactivated, never removed. */
    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// The list view's default sort, and its most common filter combination.
InventoryItemSchema.index({ isActive: 1, updatedAt: -1 });
InventoryItemSchema.index({ isActive: 1, category: 1, currentStock: 1 });
// Search across the fields the toolbar's search box covers.
InventoryItemSchema.index({ name: "text", genericName: "text", description: "text" });

module.exports = mongoose.model("InventoryItem", InventoryItemSchema, "inventoryitems");
module.exports.INVENTORY_CATEGORIES = INVENTORY_CATEGORIES;
module.exports.CATEGORY_LABELS = CATEGORY_LABELS;
module.exports.PERISHABLE_CATEGORIES = PERISHABLE_CATEGORIES;
module.exports.STORAGE_CONDITIONS = STORAGE_CONDITIONS;
module.exports.STORAGE_CONDITION_LABELS = STORAGE_CONDITION_LABELS;
