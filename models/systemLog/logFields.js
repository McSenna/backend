"use strict";

const mongoose = require("mongoose");
const { VALID_ACTIONS, VALID_ROLES, VALID_SEVERITIES } = require("./logVocabulary");

const logFields = {
  action: {
    type: String,
    required: [true, "Action is required"],
    trim: true,
    uppercase: true,
    enum: {
      values: VALID_ACTIONS,
      message: "Unsupported action type",
    },
    index: true,
  },
  role: {
    type: String,
    required: [true, "Role is required"],
    trim: true,
    lowercase: true,
    default: "unknown",
    enum: {
      values: VALID_ROLES,
      message: "Role must be admin, doctor, midwife, bhw, resident, or unknown",
    },
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    index: true,
  },
  ipAddress: {
    type: String,
    default: "unknown",
    trim: true,
    index: true,
  },
  platform: {
    type: String,
    default: "Web",
    trim: true,
    index: true,
  },
  clientPlatform: {
    type: String,
    default: "",
    trim: true,
    lowercase: true,
    index: true,
  },
  resource: {
    type: String,
    default: "",
    trim: true,
  },
  resourceId: {
    type: String,
    default: "",
    trim: true,
  },
  description: {
    type: String,
    default: "",
    trim: true,
  },
  success: {
    type: Boolean,
    default: true,
    index: true,
  },
  severity: {
    type: String,
    trim: true,
    lowercase: true,
    default: "info",
    enum: {
      values: VALID_SEVERITIES,
      message: "Severity must be info, success, warning, or error",
    },
    index: true,
  },
  userAgent: {
    type: String,
    default: "",
    trim: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
};

module.exports = { logFields };
