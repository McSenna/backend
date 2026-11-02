"use strict";

const { isResource, isAction, eventName } = require("./resources");

let io = null;

/** Set by the socket server once it is attached; null in tests and scripts, where broadcasting is a no-op. */
const setRealtimeServer = (server) => {
  io = server;
};

const getRealtimeServer = () => io;

const uniqueRooms = (rooms) => [...new Set((rooms ?? []).filter(Boolean).map(String))];

/**
 * The one way the server emits a data change. Socket.IO delivers a multi-room
 * emit once per socket, so a staff member in two of the rooms gets one event.
 * Callers pass a payload already shaped for the audience in `rooms`.
 */
const broadcast = (resource, action, payload, rooms) => {
  if (!isResource(resource)) throw new Error(`Unknown realtime resource: ${resource}`);
  if (!isAction(action)) throw new Error(`Unknown realtime action: ${action}`);

  const targets = uniqueRooms(rooms);
  if (!io || targets.length === 0) return false;

  const name = eventName(resource, action);
  const body = action === "resync" ? {} : payload;
  // Each resident delivery performs a fresh database authorization. This also
  // covers writes committed by another process and avoids a permission cache.
  io.to(targets).except("role:resident").emit(name, body);
  for (const socket of io.sockets.sockets.values()) {
    if (!targets.some((room) => socket.rooms.has(room))) continue;
    if (socket.data.role !== "resident") continue;
    socket.data.deliveryQueue = (socket.data.deliveryQueue || Promise.resolve()).then(async () => {
      if (await require("./residentAuthorization").reauthorizeSocket(socket)) socket.emit(name, body);
    }).catch(() => socket.disconnect(true));
  }
  return true;
};

const resync = (resource, rooms) => broadcast(resource, "resync", null, rooms);

/** For when the server may have missed changes: every client reloads what it shows. */
const RESYNC_EVERYTHING = "realtime:resync";

const resyncEverything = () => {
  io?.emit(RESYNC_EVERYTHING, {});
};

module.exports = { setRealtimeServer, getRealtimeServer, broadcast, resync, resyncEverything, RESYNC_EVERYTHING };
