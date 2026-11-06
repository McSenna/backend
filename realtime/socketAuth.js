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
    socket.data.platform = req.auth.platform;
    socket.data.expiresAt = typeof req.user.exp === "number" ? req.user.exp * 1000 : null;
    return next();
  } catch (error) {
    return next(toRefusal(error));
  }
};

module.exports = { authenticateSocket, isBrowserHandshake, toRequest };
