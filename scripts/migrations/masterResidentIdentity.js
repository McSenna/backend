"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const logger = require("../../utils/logger");
const { migrateResidentIdentities } = require("../../services/masterList/residentIdentityMigration");

const run = async () => {
  // Avoid loading the model: automatic index creation must wait for backfill.
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  try {
    const result = await migrateResidentIdentities(mongoose.connection.collection("master_residents"), {
      apply: process.argv.includes("--apply"),
    });
    logger.info("Master resident identity migration", result);
    if (result.conflicts || result.invalid) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};
run().catch(() => {
  logger.error("Master resident identity migration failed. Keep master list writes stopped and inspect the database privately.");
  process.exitCode = 1;
});
