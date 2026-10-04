"use strict";

// Barangay Master List: the barangay's official resident records, kept apart
// from user accounts (collection `users`). Only the admin master list service
// (services/masterList/masterResidentAdmin.js) writes here. Registration, profile
// edits and account decisions only read it, and nothing cascades between the
// two collections. Records come from the barangay's own registry, never from
// sign-ups.

const mongoose = require("mongoose");
const { SEX_OPTIONS, CIVIL_STATUS_OPTIONS } = require("../config/residency");
const { looseName, barangayKey } = require("../services/masterList/normalize");

const nameField = (label, { required = false, max = 50 } = {}) => ({
  type: String,
  trim: true,
  ...(required ? { required: [true, `${label} is required`] } : { default: "" }),
  maxlength: [max, `${label} must not exceed ${max} characters`],
});

const isCalendarDate = (value) =>
  value instanceof Date &&
  !Number.isNaN(value.getTime()) &&
  value.toISOString().endsWith("T00:00:00.000Z") &&
  value.getTime() <= Date.now();

const MasterResidentSchema = new mongoose.Schema(
  {
    masterResidentId: {
      type: String,
      required: [true, "Master resident ID is required"],
      trim: true,
      unique: true,
      immutable: true,
      match: [/^[A-Za-z0-9-]{3,40}$/, "Master resident ID must be 3 to 40 letters, digits or dashes"],
    },
    firstName: nameField("First name", { required: true }),
    middleName: nameField("Middle name"),
    lastName: nameField("Last name", { required: true }),
    suffix: nameField("Suffix", { max: 20 }),
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
      validate: {
        validator: isCalendarDate,
        message: "Date of birth must be a past calendar date stored as YYYY-MM-DD (UTC midnight)",
      },
    },
    sex: {
      type: String,
      required: [true, "Sex is required"],
      trim: true,
      lowercase: true,
      enum: { values: SEX_OPTIONS, message: "Sex must be male or female" },
    },
    civilStatus: {
      type: String,
      required: [true, "Civil status is required"],
      trim: true,
      lowercase: true,
      enum: {
        values: CIVIL_STATUS_OPTIONS,
        message: "Civil status must be single, married, widowed, or separated",
      },
    },
    barangay: nameField("Barangay", { required: true, max: 100 }),
    address: nameField("Address", { required: true, max: 255 }),
    // Always "resident": a master record is never a staff account, and it
    // never sets the role of any user account.
    role: {
      type: String,
      enum: { values: ["resident"], message: "Master list records are always residents" },
      default: "resident",
      immutable: true,
    },
    // Residents who moved away or died stay on file but are never matched.
    isActive: { type: Boolean, default: true },
    // Audit: the admin who added, last edited, or deactivated the record.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Derived lookup keys, rebuilt from the official fields on every save.
    // They are never shown and never written back to the official fields.
    matchKeys: {
      firstName: { type: String, default: "" },
      lastName: { type: String, default: "" },
      barangay: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
    collection: "master_residents",
  }
);

// Lookups by barangay plus birth date, or barangay plus name. Neither index is
// unique, so two residents with the same name or birthday are both allowed.
MasterResidentSchema.index({ "matchKeys.barangay": 1, isActive: 1, dateOfBirth: 1 });
MasterResidentSchema.index({
  "matchKeys.barangay": 1,
  isActive: 1,
  "matchKeys.lastName": 1,
  "matchKeys.firstName": 1,
});

MasterResidentSchema.pre("validate", function () {
  this.matchKeys = {
    firstName: looseName(this.firstName),
    lastName: looseName(this.lastName),
    barangay: barangayKey(this.barangay),
  };
});

module.exports = mongoose.model("MasterResident", MasterResidentSchema);
