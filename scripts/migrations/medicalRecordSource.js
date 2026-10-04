"use strict";

// Runs the medical record source migration by hand (it also runs at startup):
//   node scripts/migrations/medicalRecordSource.js

require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const logger = require("../../utils/logger");
const { migrateMedicalRecordSources } = require("../../services/medicalRecord/sourceMigration");

const run = async () => {
  await connectDB();
  try {
    const result = await migrateMedicalRecordSources();
    logger.info("Medical record source migration finished", result);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  logger.error("Medical record source migration failed", { errorName: error?.name });
  process.exit(1);
});
