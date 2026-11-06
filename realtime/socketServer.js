"use strict";

const { Server } = require("socket.io");

const logger = require("../utils/logger");
const { authenticateSocket } = require("./socketAuth");
const { buildSocketCorsOptions } = require("./socketCors");
const { roomsForAccount, userRoom } = require("./rooms");
const { setRealtimeServer, getRealtimeServer } = require("./broadcast");

const MAX_CLIENT_MESSAGE_BYTES = 4 * 1024;

const MAX_TIMER_MS = 2 ** 31 - 1;

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
  // Recheck even idle connections across server instances; data sends recheck too.
  if (socket.data.role === "resident") {
    const timer = setInterval(() => { void require("./residentAuthorization").reauthorizeSocket(socket); }, 15000);
    timer.unref();
    socket.once("disconnect", () => clearInterval(timer));
  }
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

const adoptSessionToken = (userId, sessionId, token) => {
  const io = getRealtimeServer();
  if (!io || !sessionId) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId !== String(userId) || socket.data.sessionId !== sessionId) continue;
    socket.handshake.auth = { ...socket.handshake.auth, token };
  }
};

/** Drops every socket of an account except one session's, e.g. after that session changed the password. */
const disconnectOtherSessions = async (userId, keepSessionId) => {
  const io = getRealtimeServer();
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const socket of sockets) {
    if (!keepSessionId || socket.data.sessionId !== keepSessionId) socket.disconnect(true);
  }
};

const closeRealtime = () => {
  const io = getRealtimeServer();
  if (!io) return;
  setRealtimeServer(null);
  io.disconnectSockets(true);
};

module.exports = {
  attachRealtime,
  disconnectUser,
  disconnectSession,
  adoptSessionToken,
  disconnectOtherSessions,
  closeRealtime,
};
