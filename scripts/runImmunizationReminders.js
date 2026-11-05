"use strict";
require("dotenv").config();
// Clinic days are Manila days. An external scheduler usually runs in UTC, so this
// must match server.js or a Thursday's slots would be worked out in the wrong zone.
process.env.TZ = process.env.APP_TIMEZONE || "Asia/Manila";
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Reminder = require("../models/ImmunizationReminder");
const Notification = require("../models/Notification");
const { runImmunizationReminders } = require("../services/immunization/reminderWorker");

(async () => {
  try {
    await connectDB();
    await require('../services/immunization/initialize').initializeImmunization();
    await Promise.all([Reminder.init(), Notification.init()]);
    const result = await runImmunizationReminders();
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } catch (error) { console.error("Immunization reminders failed:", error.name); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
