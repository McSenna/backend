"use strict";

const mongoose = require("mongoose");

/**
 * One signed-in session: written at sign-in, ended at logout. A row counts as
 * active only while its tokenVersion matches the account's, so a password
 * change or an "all devices" logout retires every row without touching them.
 * Rows delete themselves when the token they describe expires.
 */
const schema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  platform: { type: String, required: true },
  tokenVersion: { type: Number, required: true },
  /** "Linux · Chrome", read from the sign-in request's User-Agent; null when nothing is recognised. Never the raw header. */
  device: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ user: 1, endedAt: 1, expiresAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AuthSession", schema);
