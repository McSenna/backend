"use strict";

const logger = require("../utils/logger");

const REQUIRED = [
  { key: "MONGO_URI", why: "the database connection string" },
  { key: "JWT_SECRET", why: "signing and verifying session tokens" },
];

const MIN_SECRET_LENGTH = 32;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function validateEnv() {
  const problems = [];

  for (const { key, why } of REQUIRED) {
    if (!String(process.env[key] || "").trim()) {
      problems.push(`${key} is not set (needed for ${why}).`);
    }
  }

  const secret = String(process.env.JWT_SECRET || "");
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    const message = `JWT_SECRET is only ${secret.length} characters; use at least ${MIN_SECRET_LENGTH}.`;
    if (isProduction()) problems.push(message);
    else logger.warn(message);
  }

  if (isProduction() && !String(process.env.CLIENT_ORIGINS || "").trim()) {
    logger.warn(
      "CLIENT_ORIGINS is not set; browser clients on other origins will be refused by CORS."
    );
  }

  if (problems.length > 0) {
    for (const problem of problems) logger.error(`Configuration error: ${problem}`);
    throw new Error(`Invalid configuration: ${problems.length} problem(s) found. See the log above.`);
  }

  logger.info("Configuration validated", { nodeEnv: process.env.NODE_ENV || "development" });
}

module.exports = { validateEnv, isProduction };
