"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  notification: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", required: true },
  device: { type: mongoose.Schema.Types.ObjectId, ref: "PushDevice", required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sessionId: { type: String, required: true },
  state: { type: String, enum: ["pending", "sending", "receipt", "checking", "accepted", "failed"], default: "pending" },
  nextAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 },
  receiptId: String,
  sentToken: { type: String, select: false },
  receiptStartedAt: Date,
  lastError: String,
}, { timestamps: true });
schema.index({ notification: 1, device: 1 }, { unique: true });
schema.index({ state: 1, nextAt: 1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });
module.exports = mongoose.model("PushDelivery", schema);
