"use strict";

const mongoose = require("mongoose");
const { VALID_STATUSES } = require("./userStatus");
const { VERIFICATION_METHODS } = require("../../config/masterList");

const accountFields = {
  verified: {
    type: Boolean,
    default: false,
    index: true,
  },

  status: {
    type: String,
    trim: true,
    lowercase: true,
    enum: {
      values: VALID_STATUSES,
      message: "Status must be active, inactive, pending, or suspended",
    },
    index: true,
  },
  role: {
    type: String,
    enum: {
      values: ["admin", "doctor", "midwife", "bhw", "resident"],
      message: "Role must be admin, doctor, midwife, bhw, or resident",
    },
    default: "resident",
    index: true,
  },

  lastLogin: {
    type: Date,
    default: null,
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  approved_at: {
    type: Date,
    default: null,
  },
  rejected_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  rejected_at: {
    type: Date,
    default: null,
  },
  rejection_reason: {
    type: String,
    default: "",
    trim: true,
  },
  rejection_remarks: {
    type: String,
    default: "",
    trim: true,
  },

  // How a resident's registration was decided. `status`, `approved_*` and
  // `rejected_*` stay the source of truth for the decision itself; an empty
  // value means the account predates the master list check.
  verificationMethod: {
    type: String,
    enum: {
      values: ["", ...Object.values(VERIFICATION_METHODS)],
      message: "Verification method must be master_list or admin_review",
    },
    default: "",
  },
  // The official master list record this account belongs to, set by the server
  // only. Linking never copies or changes the master record's details.
  masterResidentId: {
    type: String,
    trim: true,
    default: undefined,
  },
};

module.exports = { accountFields };
