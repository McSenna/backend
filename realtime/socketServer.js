"use strict";

const { Server } = require("socket.io");

const logger = require("../utils/logger");
const { authenticateSocket } = require("./socketAuth");
const { buildSocketCorsOptions } = require("./socketCors");
const { roomsForAccount, userRoom } = require("./rooms");
const { setRealtimeServer, getRealtimeServer } = require("./broadcast");

// Clients only listen; the largest thing they send is the handshake.
const MAX_CLIENT_MESSAGE_BYTES = 4 * 1024;
// setTimeout overflows past ~24.8 days; tokens are far shorter, but stay safe.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * A socket outlives the request that opened it, so the token's expiry is
 * enforced here: when it lapses the server drops the socket, and the client's
 * reconnect is refused with TOKEN_EXPIRED, which signs it out like a REST 401.
 */
const scheduleExpiry = (socket) => {
  const { expiresAt } = socket.data;
  if (!expiresAt) return;

  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    socket.disconnect(true);
    return;
  }

  const timer = setTimeout(() => socket.disconnect(true), Math.min(remaining, MAX_TIMER_MS));
  timer.unref();
  socket.once("disconnect", () => clearTimeout(timer));
};

const onConnection = (socket) => {
  socket.join(roomsForAccount(socket.data));
  scheduleExpiry(socket);
};

/** Shares the Express HTTP server: same port, same TLS, no second listener. */
const attachRealtime = (httpServer) => {
  const io = new Server(httpServer, {
    transports: ["websocket"],
    serveClient: false,
    maxHttpBufferSize: MAX_CLIENT_MESSAGE_BYTES,
    ...buildSocketCorsOptions(),
  });

  io.use(authenticateSocket);
  io.on("connection", onConnection);
  io.engine.on("connection_error", (error) => {
    logger.warn("Realtime: connection refused", { code: error?.code, reason: error?.message });
  });

  setRealtimeServer(io);
  return io;
};

/** Drops every socket of an account, e.g. when it is suspended or its role changes. */
const disconnectUser = (userId) => {
  getRealtimeServer()?.in(userRoom(userId)).disconnectSockets(true);
};

/** Drops the sockets of one signed-in session, so a logout ends its live feed too. */
const disconnectSession = async (userId, sessionId) => {
  const io = getRealtimeServer();
  if (!io || !sessionId) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const socket of sockets) {
    if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
};

/**
 * Drops every socket so the HTTP server can finish closing. Not io.close():
 * that also closes the HTTP server, which shutdown already does.
 */
const closeRealtime = () => {
  const io = getRealtimeServer();
  if (!io) return;
  setRealtimeServer(null);
  io.disconnectSockets(true);
};

module.exports = { attachRealtime, disconnectUser, disconnectSession, closeRealtime };
