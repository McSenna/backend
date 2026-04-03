"use strict";

const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    resident: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    consultationType: { type: String, required: true },
    description: { type: String, default: "", maxlength: 4000 },
    isUrgent: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ["pending", "confirmed", "declined", "rescheduled"],
      default: "pending",
      index: true,
    },

    /** Stored as strict 0–4 triage priority tag (lower number = higher priority). */
    // 0 → Age 0–1 (infants), 1 → Age 60+ (elderly), 2 → Age 2–12, 3 → Age 13–17, 4 → Age 18–59
    ageTier: { type: Number, required: true, min: 0, max: 4 },
    // Lower sorts first. Sorting tie-breaker is handled by createdAt in queries.
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
  },
  { timestamps: true }
);

AppointmentSchema.index({ status: 1, prioritySortKey: 1, createdAt: 1 });
AppointmentSchema.index({ missionSchedule: 1, slotStart: 1 });

module.exports = mongoose.model("Appointment", AppointmentSchema);
