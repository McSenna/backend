"use strict";

const { isAllowedBrowserOrigin } = require("../config/cors");
const logger = require("../utils/logger");

const hostOf = (origin) => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * Socket.IO's `cors` option covers only HTTP long-polling. Browsers apply no
 * CORS to a WebSocket upgrade, so the Origin is checked here, with the same
 * rule REST uses. Allowed without a listed origin: native clients that send
 * none, and React Native's default Origin, which is the API's own host.
 */
const isAllowedOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (isAllowedBrowserOrigin(origin)) return true;
  const host = typeof req.headers.host === "string" ? req.headers.host.toLowerCase() : null;
  return Boolean(host && hostOf(origin) === host);
};

const buildSocketCorsOptions = () => ({
  cors: { origin: (origin, done) => done(null, !origin || isAllowedBrowserOrigin(origin)), credentials: true },
  allowRequest: (req, done) => {
    if (isAllowedOrigin(req)) return done(null, true);
    logger.warn("Realtime: refused a socket from an unlisted origin", { origin: req.headers.origin });
    return done(null, false);
  },
});

module.exports = { buildSocketCorsOptions, isAllowedOrigin };
