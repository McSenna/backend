"use strict";

const logger = require("../utils/logger");
const { parseOrigins } = require("../utils/origins");

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

  const origins = parseOrigins(process.env.CLIENT_ORIGINS);
  if (origins.invalid.length > 0) {
    const message = `CLIENT_ORIGINS has entries a browser can never send: ${origins.invalid.join(", ")}. Use full origins like https://maslogcare.com.`;
    if (isProduction()) problems.push(message);
    else logger.warn(message);
  }

  if (isProduction() && origins.valid.length === 0) {
    logger.warn(
      "CLIENT_ORIGINS is not set; browser clients on other origins will be refused by CORS."
    );
  }

  // Render sets RENDER=true. Behind its proxy every request arrives from the
  // proxy's address, so without TRUST_PROXY all visitors share one sign-in and OTP limit.
  if (process.env.RENDER === "true" && !String(process.env.TRUST_PROXY || "").trim()) {
    logger.warn("TRUST_PROXY is not set; rate limits will count every visitor as the same device.");
  }

  if (problems.length > 0) {
    for (const problem of problems) logger.error(`Configuration error: ${problem}`);
    throw new Error(`Invalid configuration: ${problems.length} problem(s) found. See the log above.`);
  }

  logger.info("Configuration validated", { nodeEnv: process.env.NODE_ENV || "development" });
}

module.exports = { validateEnv, isProduction };
