"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  pushToken: { type: String, required: true, unique: true, select: false },
  platform: { type: String, enum: ["android"], required: true },
  sessionId: { type: String, required: true },
  tokenVersion: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ user: 1, active: 1, expiresAt: 1 });
module.exports = mongoose.model("PushDevice", schema);
