"use strict";

const { isProduction } = require("./env");
const { isLocalHostname, normalizeOrigin, parseOrigins } = require("../utils/origins");
const logger = require("../utils/logger");

function configuredOrigins() {
  return parseOrigins(process.env.CLIENT_ORIGINS).valid;
}

/**
 * The one origin rule for REST and Socket.IO. Development also accepts local
 * dev servers, since Expo's web port and the computer's LAN address both move.
 */
function isAllowedBrowserOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (configuredOrigins().includes(normalized)) return true;
  return !isProduction() && isLocalHostname(new URL(normalized).hostname);
}

function buildCorsOptions() {
  logger.info("CORS: allowed browser origins", {
    listed: configuredOrigins().length,
    localDevServers: !isProduction(),
  });

  return {
    origin(origin, callback) {
      // Native apps and server-to-server calls send no Origin; CORS does not apply to them.
      if (!origin || isAllowedBrowserOrigin(origin)) return callback(null, true);

      logger.warn("CORS: blocked a cross-origin request", { origin });
      return callback(null, false);
    },
    credentials: true,
  };
}

module.exports = { buildCorsOptions, isAllowedBrowserOrigin };
