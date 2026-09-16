"use strict";

const { isProduction } = require("./env");
const logger = require("../utils/logger");

function configuredOrigins() {
  return String(process.env.CLIENT_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildCorsOptions() {
  const allowed = configuredOrigins();

  if (!isProduction()) {
    logger.info("CORS: development mode — all origins allowed");
    return { origin: true, credentials: true };
  }

  logger.info("CORS: production mode", { allowedOrigins: allowed.length });

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);

      logger.warn("CORS: blocked a cross-origin request", { origin });
      return callback(null, false);
    },
    credentials: true,
  };
}

module.exports = { buildCorsOptions, configuredOrigins };
