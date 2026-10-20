"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const logger = require("../../utils/logger");
const { migrateResidentRoles } = require("../../services/masterList/residentRoleMigration");

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  try {
    const result = await migrateResidentRoles(mongoose.connection.collection("master_residents"), {
      apply: process.argv.includes("--apply"),
    });
    logger.info("Master resident classification migration", result);
  } finally {
    await mongoose.disconnect();
  }
};
run().catch(() => {
  logger.error("Master resident classification migration failed. Inspect the database privately before retrying.");
  process.exitCode = 1;
});
