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

    unit: { type: String, required: [true, "Unit is required"], trim: true, maxlength: 24 },

    reorderLevel: { type: Number, required: true, min: [0, "Reorder level cannot be negative"], default: 0 },

    storageCondition: {
      type: String,
      enum: STORAGE_CONDITIONS,
      default: "room-temperature",
    },

    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null, index: true },

    currentStock: { type: Number, default: 0, min: 0, index: true },

    nearestExpiry: { type: Date, default: null, index: true },

    lastRestockedAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

InventoryItemSchema.index({ isActive: 1, updatedAt: -1 });
InventoryItemSchema.index({ isActive: 1, category: 1, currentStock: 1 });
InventoryItemSchema.index({ name: "text", genericName: "text", description: "text" });

module.exports = mongoose.model("InventoryItem", InventoryItemSchema, "inventoryitems");
module.exports.INVENTORY_CATEGORIES = INVENTORY_CATEGORIES;
module.exports.CATEGORY_LABELS = CATEGORY_LABELS;
module.exports.PERISHABLE_CATEGORIES = PERISHABLE_CATEGORIES;
module.exports.STORAGE_CONDITIONS = STORAGE_CONDITIONS;
module.exports.STORAGE_CONDITION_LABELS = STORAGE_CONDITION_LABELS;
