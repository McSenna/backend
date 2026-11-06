"use strict";
const { getRealtimeServer } = require("./broadcast");

const disconnectWhere = (matches) => {
  const sockets = getRealtimeServer()?.sockets.sockets;
  if (!sockets) return;
  for (const socket of sockets.values())
    if (matches(socket.data)) socket.disconnect(true);
};
const disconnectResidentWeb = (userId) =>
  disconnectWhere(
    (data) =>
      data.role === "resident" &&
      data.platform !== "mobile" &&
      (!userId || data.userId === userId),
  );

const tokenOf = (socket) => socket.handshake.auth?.token;

const reauthorizeSocket = async (socket) => {
  if (!socket.connected) return false;
  const checkedToken = tokenOf(socket);
  try {
    const {
      authenticateSession,
      enforcePlatformAccess,
    } = require("../middleware/authMiddleware");
    const { toRequest } = require("./socketAuth");
    const req = toRequest(socket.handshake);
    await authenticateSession(req);
    await new Promise((resolve, reject) =>
      enforcePlatformAccess(req, null, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    return socket.connected;
  } catch (error) {
    // The session was re-issued a token while this check ran (a password
    // change): the refusal is about the old one, so check the new one.
    if (tokenOf(socket) !== checkedToken) return reauthorizeSocket(socket);
    const denied = error.statusCode === 401 || error.statusCode === 403;
    socket.emit("access:revoked", {
      code: denied ? error.code : "SERVER_UNAVAILABLE",
    });
    socket.disconnect(true);
    return false;
  }
};
// A socket with no remaining access is told why and dropped by reauthorizeSocket.
const recheckResidentWeb = async () => {
  const sockets = getRealtimeServer()?.sockets.sockets;
  if (!sockets) return;
  const residentWeb = [...sockets.values()].filter(
    ({ data }) => data.role === "resident" && data.platform !== "mobile",
  );
  await Promise.all(residentWeb.map(reauthorizeSocket));
};
module.exports = {
  disconnectResidentWeb,
  recheckResidentWeb,
  reauthorizeSocket,
};
