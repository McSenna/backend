"use strict";

const MasterResident = require("../../models/MasterResident");
const { migrateResidentIdentities } = require("./residentIdentityMigration");
const { serviceUnavailable } = require("../../utils/AppError");
const logger = require("../../utils/logger");

// Called before HTTP starts. Let automatic index creation settle before the
// backfill; legacy missing keys may make that initial unique-index build fail.
const initializeResidentIdentity = async () => {
  try {
    await MasterResident.init();
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const result = await migrateResidentIdentities(MasterResident.collection, { apply: true });
  logger.info("Master resident identity preparation", result);
  if (!result.applied) {
    throw serviceUnavailable("Master list data needs administrator review before the server can start.");
  }
  return result;
};

module.exports = { initializeResidentIdentity };
