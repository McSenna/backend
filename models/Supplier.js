"use strict";

const mongoose = require("mongoose");

/**
 * Where stock comes from.
 *
 * Barangay health centres are supplied almost entirely by government units and
 * donations rather than by commercial vendors, so `type` names the channel the
 * stock arrived through — that is what a Current Stock report has to break
 * down by, and what an auditor asks about first.
 */
const SUPPLIER_TYPES = ["doh", "city-health", "lgu", "private", "donation", "other"];

const SUPPLIER_TYPE_LABELS = {
  doh: "DOH",
  "city-health": "City Health Office",
  lgu: "Local Government",
  private: "Private Supplier",
  donation: "Donation",
  other: "Other",
};

const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    contactPerson: { type: String, default: "", trim: true, maxlength: 160 },
    phone: { type: String, default: "", trim: true, maxlength: 40 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
    address: { type: String, default: "", trim: true, maxlength: 255 },
    type: { type: String, enum: SUPPLIER_TYPES, default: "other", index: true },
    /** Soft delete — a supplier named by historic transactions is never removed. */
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", SupplierSchema, "suppliers");
module.exports.SUPPLIER_TYPES = SUPPLIER_TYPES;
module.exports.SUPPLIER_TYPE_LABELS = SUPPLIER_TYPE_LABELS;
