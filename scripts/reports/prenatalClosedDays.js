"use strict";
require("dotenv").config();
// Weekdays are Manila weekdays, as in server.js, whatever zone the shell runs in.
process.env.TZ = process.env.APP_TIMEZONE || "Asia/Manila";
const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const Appointment = require("../../models/Appointment");
const { visitsOnClosedDays } = require("../../services/regularSchedule/closedDayAudit");

// Lists prenatal visits on a day prenatal no longer runs (Thursday). It reads
// only, prints ids, statuses and times, and never names or reasons.
(async () => {
  try {
    await connectDB();
    const rows = await Appointment.find({ consultationType: "prenatal", slotStart: { $ne: null } })
      .select("_id status slotStart missionSchedule")
      .lean();
    const found = visitsOnClosedDays("prenatal", rows);
    console.log(JSON.stringify({ checked: rows.length, onClosedDays: found.length, active: found.filter((row) => row.active).length, visits: found }, null, 2));
  } catch (error) {
    console.error("Prenatal closed-day report failed:", error.name);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
