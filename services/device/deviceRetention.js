"use strict";

const SystemLog = require("../../models/SystemLog");
const logger = require("../../utils/logger");
const { DEVICE_RETENTION_DAYS } = require("../../config/deviceRetention");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Clears device details from audit entries older than the retention period.
 * The entry itself stays; its device becomes `{ purgedAt }` and the raw
 * User-Agent is emptied. The devices collection expires by its own TTL index.
 */
const purgeExpiredDeviceDetails = async ({ now = new Date() } = {}) => {
  const cutoff = new Date(now.getTime() - DEVICE_RETENTION_DAYS * DAY_MS);
  const result = await SystemLog.collection.updateMany(
    {
      createdAt: { $lt: cutoff },
      $or: [{ userAgent: { $nin: ["", null] } }, { device: { $exists: true }, "device.purgedAt": { $exists: false } }],
    },
    { $set: { device: { purgedAt: now }, userAgent: "" } },
  );
  return { cutoff, cleared: result.modifiedCount };
};

const startDeviceRetentionScheduler = ({ intervalMs = DAY_MS } = {}) => {
  if (process.env.DEVICE_RETENTION_DISABLED === "true") return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { cleared } = await purgeExpiredDeviceDetails();
      if (cleared > 0) logger.info("Expired device details cleared", { cleared });
    } catch (error) {
      logger.error("Device retention job failed", { errorName: error?.name });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};

module.exports = { purgeExpiredDeviceDetails, startDeviceRetentionScheduler };
