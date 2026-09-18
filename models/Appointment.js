"use strict";

const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    resident: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    consultationType: { type: String, required: true },
    description: { type: String, default: "", maxlength: 4000 },
    additionalNotes: { type: String, default: "", maxlength: 1000 },
    isUrgent: { type: Boolean, default: false },

    preferredProvider: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    status: {
      type: String,
      enum: ["pending", "confirmed", "declined", "rescheduled", "processing", "completed", "cancelled"],
      default: "pending",
      index: true,
    },

    ageTier: { type: Number, required: true, min: 0, max: 4 },
    prioritySortKey: { type: Number, required: true, min: 0, max: 4, index: true },
    ageAtSubmission: { type: Number },

    missionSchedule: { type: mongoose.Schema.Types.ObjectId, ref: "MissionSchedule", default: null },
    assignedCategoryKey: { type: String, default: null },
    assignedDurationMinutes: { type: Number, default: null },
    slotStart: { type: Date, default: null },
    slotEnd: { type: Date, default: null },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedAt: { type: Date, default: null },

    declineReason: { type: String, default: "", maxlength: 1000 },
    cancelReason: { type: String, default: "", maxlength: 1000 },

    approvedAt: { type: Date, default: null },

    processingAt: { type: Date, default: null },

    completedAt: { type: Date, default: null },

    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    medicalRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MedicalRecord",
      default: null,
    },

    statusHistory: {
      type: [
        {
          _id: false,
          status: {
            type: String,
            enum: ["pending", "confirmed", "declined", "rescheduled", "processing", "completed", "cancelled"],
            required: true,
          },
          timestamp: { type: Date, required: true },
          changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          note: { type: String, default: "", maxlength: 300 },
        },
      ],
      default: () => [],
    },
  },
  { timestamps: true }
);

const QUEUE_ACTIVE_STATUSES = Object.freeze(["confirmed", "rescheduled", "processing"]);

const COMPLETABLE_STATUSES = Object.freeze(["confirmed", "rescheduled", "processing"]);

function pushStatusHistory(appointment, status, changedBy = null, note = "") {
  const history = appointment.statusHistory || [];
  const last = history[history.length - 1];
  if (last && last.status === status) return;
  history.push({
    status,
    timestamp: new Date(),
    changedBy: changedBy || null,
    note: typeof note === "string" ? note.slice(0, 300) : "",
  });
  appointment.statusHistory = history;
}

AppointmentSchema.index({ status: 1, prioritySortKey: 1, createdAt: 1 });
AppointmentSchema.index({ missionSchedule: 1, slotStart: 1 });

AppointmentSchema.index({ status: 1, completedAt: -1 });

const Appointment = mongoose.model("Appointment", AppointmentSchema, "appointments");

module.exports = Appointment;
module.exports.QUEUE_ACTIVE_STATUSES = QUEUE_ACTIVE_STATUSES;
module.exports.COMPLETABLE_STATUSES = COMPLETABLE_STATUSES;
module.exports.pushStatusHistory = pushStatusHistory;
