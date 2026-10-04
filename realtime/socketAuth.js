"use strict";

const { authenticateSession, enforcePlatformAccess } = require("../middleware/authMiddleware");
const { normalizePlatform, PLATFORMS } = require("../config/platformAccess");
const { unauthorized } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

const FETCH_METADATA_HEADERS = ["sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest"];

const hostOf = (value) => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * REST treats any Origin header as a browser. That cannot hold for sockets:
 * React Native's Android WebSocket always sends `Origin: <scheme>://<api host>`,
 * so every resident would be refused as "a mobile session used in a browser".
 * Browsers send Fetch Metadata headers on WebSocket handshakes, and their
 * Origin is the page's host rather than the API's, so either one marks a browser.
 */
const isBrowserHandshake = (headers) => {
  if (FETCH_METADATA_HEADERS.some((name) => typeof headers[name] === "string")) return true;
  const origin = typeof headers.origin === "string" ? hostOf(headers.origin) : null;
  const host = typeof headers.host === "string" ? headers.host.toLowerCase() : null;
  return Boolean(origin && host && origin !== host);
};

const resolveHandshakePlatform = (headers, claimed) => {
  if (isBrowserHandshake(headers)) {
    return { platform: PLATFORMS.WEB, claimed, isBrowserRequest: true, source: "browser-signal" };
  }
  return {
    platform: claimed || PLATFORMS.WEB,
    claimed,
    isBrowserRequest: false,
    source: claimed ? "client-claim" : "fallback",
  };
};

/** Shapes the handshake like an Express request so the REST guards run unchanged. */
const toRequest = (handshake) => {
  const auth = handshake.auth && typeof handshake.auth === "object" ? handshake.auth : {};
  const token = typeof auth.token === "string" ? auth.token.trim() : "";
  const claimed = normalizePlatform(auth.platform);
  const headers = { ...handshake.headers, authorization: token ? `Bearer ${token}` : "" };

  return {
    headers,
    body: {},
    query: {},
    clientPlatform: resolveHandshakePlatform(handshake.headers, claimed),
  };
};

/**
 * The client reads `data.code`: an auth code signs the user out, anything else
 * is retried. A database outage during the handshake must never look like an
 * expired session, or every connected device would be logged out at once.
 */
const toRefusal = (error) => {
  const isAuthRefusal = error?.statusCode === 401 || error?.statusCode === 403;
  const refusal = new Error(isAuthRefusal ? "Unauthorized" : "Unavailable");
  refusal.data = { code: isAuthRefusal ? error.code : "SERVER_UNAVAILABLE" };
  return refusal;
};

const runPlatformGuard = (req) =>
  new Promise((resolve, reject) => {
    enforcePlatformAccess(req, null, (error) => (error ? reject(error) : resolve()));
  });

/**
 * Socket.IO middleware. Uses the same checks as every REST call (signature,
 * expiry, account exists and is not blocked, role allowed on this platform)
 * and stores what the connection needs on socket.data.
 */
const authenticateSocket = async (socket, next) => {
  try {
    const req = toRequest(socket.handshake);
    if (!req.headers.authorization) {
      throw unauthorized("Authentication is required.", ERROR_CODES.AUTHENTICATION_REQUIRED);
    }

    await authenticateSession(req);
    await runPlatformGuard(req);

    socket.data.userId = req.user.userId;
    socket.data.role = req.user.role;
    socket.data.sessionId = req.auth.sessionId;
    socket.data.expiresAt = typeof req.user.exp === "number" ? req.user.exp * 1000 : null;
    return next();
  } catch (error) {
    return next(toRefusal(error));
  }
};

module.exports = { authenticateSocket, isBrowserHandshake, toRequest };
