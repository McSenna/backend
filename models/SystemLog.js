const mongoose = require("mongoose");

const VALID_ACTIONS = [
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "RESIDENT_WEB_LOGIN_BLOCKED",
  "PLATFORM_ACCESS_DENIED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DELETED",
  "USER_ROLE_CHANGED",
  "USER_STATUS_CHANGED",
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
  "INVENTORY_ITEM_CREATED",
  "INVENTORY_ITEM_UPDATED",
  "INVENTORY_ITEM_DEACTIVATED",
  "INVENTORY_STOCK_IN",
  "INVENTORY_STOCK_OUT",
  "INVENTORY_ADJUSTED",
  "INVENTORY_EXPIRED_RECORDED",
];

const VALID_ROLES = ["admin", "doctor", "midwife", "bhw", "resident", "unknown"];

const VALID_SEVERITIES = ["info", "success", "warning", "error"];

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
SystemLogSchema.index({ severity: 1, createdAt: -1 });

module.exports = mongoose.model("SystemLog", SystemLogSchema, "systemlogs");
module.exports.VALID_ACTIONS = VALID_ACTIONS;
module.exports.VALID_ROLES = VALID_ROLES;
module.exports.VALID_SEVERITIES = VALID_SEVERITIES;
