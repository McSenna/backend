"use strict";

const logger = require("../utils/logger");
const { attachRealtime, closeRealtime, disconnectSession, disconnectUser } = require("./socketServer");
const { startChangeFeed } = require("./changeFeed");
const { broadcast, resync } = require("./broadcast");
const publishers = require("./publishers");

let stopFeed = null;

/**
 * Attaches Socket.IO to the HTTP server and starts the change feed. Call after
 * the database is connected. REST stays the source of truth: sockets only
 * announce committed writes, and clients reload from REST whenever they reconnect.
 */
const startRealtime = (httpServer) => {
  attachRealtime(httpServer);
  stopFeed = startChangeFeed(publishers);
  logger.info("Realtime updates enabled", { feeds: publishers.length });
};

const stopRealtime = async () => {
  closeRealtime();
  if (stopFeed) await stopFeed();
  stopFeed = null;
};

module.exports = { startRealtime, stopRealtime, broadcast, resync, disconnectSession, disconnectUser };
