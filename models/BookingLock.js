"use strict";

const mongoose = require("mongoose");

// One document per bookable day of a service that has no mission document to
// lock (immunization). Bumping `version` inside a transaction serializes every
// booking for that day, the same way MissionSchedule.bookingVersion does.
const BookingLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BookingLock", BookingLockSchema, "booking_locks");
