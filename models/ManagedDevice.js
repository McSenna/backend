"use strict";
// Read-only since device provisioning was removed (2026-11-06). Kept only so
// services/auth/revokedDeviceSessions.js can honour revocations made before then.
const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    residentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    credentialHash: { type: String, required: true, select: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
module.exports = mongoose.model("ManagedDevice", schema);
