"use strict";

const mongoose = require("mongoose");
const { VALID_STATUSES } = require("./userStatus");

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
};

module.exports = { accountFields };
