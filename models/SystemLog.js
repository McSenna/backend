const mongoose = require("mongoose");

const VALID_ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DELETED",
  "USER_ROLE_CHANGED",
  "USER_VERIFIED",
  "USER_UNVERIFIED",
  "APPOINTMENT_CREATED",
  "APPOINTMENT_UPDATED",
  "APPOINTMENT_APPROVED",
  "APPOINTMENT_REJECTED",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_RESCHEDULED",
  "RECORD_CREATED",
  "RECORD_UPDATED",
  "RECORD_VIEWED",
  "SCHEDULE_CREATED",
  "SCHEDULE_UPDATED",
  "SCHEDULE_DELETED",
];

const VALID_ROLES = ["admin", "doctor", "midwife", "bhw", "resident", "unknown"];

const SystemLogSchema = new mongoose.Schema(
  {
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
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "systemlogs",
  }
);

SystemLogSchema.index({ createdAt: -1 });
SystemLogSchema.index({ action: 1, createdAt: -1 });
SystemLogSchema.index({ role: 1, createdAt: -1 });
SystemLogSchema.index({ platform: 1, createdAt: -1 });
SystemLogSchema.index({ ipAddress: 1, createdAt: -1 });
SystemLogSchema.index({ action: 1, role: 1, createdAt: -1 });

module.exports = mongoose.model("SystemLog", SystemLogSchema, "systemlogs");
module.exports.VALID_ACTIONS = VALID_ACTIONS;
module.exports.VALID_ROLES = VALID_ROLES;
