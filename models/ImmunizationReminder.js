"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  babyId: { type: mongoose.Schema.Types.ObjectId, ref: "Baby", required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  visitKey: { type: String, required: true },
  scheduledOn: { type: String, required: true },
  stage: { type: String, match: /^(?:\d+|overdue)$/, required: true },
  doseVisits: { type: [new mongoose.Schema({ key: String, scheduledOn: String }, { _id: false })], default: [] },
  doseKeys: [{ type: String }],
  dedupeKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ["pending", "delivered", "cancelled"], default: "pending", index: true },
  attempts: { type: Number, default: 0 },
  attemptHistory: { type: [new mongoose.Schema({ at: Date, outcome: { type: String, enum: ["delivered", "failed"] }, errorCode: String }, { _id: false })], default: [] },
  nextAttemptAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  lastError: { type: String, default: "" },
}, { timestamps: true });
schema.index({ babyId: 1, recipient: 1, visitKey: 1, stage: 1 }, { unique: true });
module.exports = mongoose.model("ImmunizationReminder", schema);
