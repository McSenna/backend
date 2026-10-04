"use strict";

// A healthy batch reaches sockets about 200ms after commit against Atlas.
const SLOW_BATCH_MS = 1000;

/**
 * Commit to arrival. It compares the database's clock with this server's, so
 * it is approximate; servers before MongoDB 6.0 send no wallTime.
 */
const commitLagMs = (wallTime, receivedWallClock = Date.now()) =>
  wallTime instanceof Date ? Math.max(0, receivedWallClock - wallTime.getTime()) : 0;

/** Stage durations of a batch whose oldest change took too long from commit to emit; null otherwise. */
const slowBatchReport = (arrival, startedAt, finishedAt) => {
  const lagMs = Math.round(arrival.lagMs);
  const waitMs = Math.round(startedAt - arrival.receivedAt);
  const publishMs = Math.round(finishedAt - startedAt);
  const totalMs = lagMs + waitMs + publishMs;
  return totalMs > SLOW_BATCH_MS ? { lagMs, waitMs, publishMs, totalMs } : null;
};

module.exports = { SLOW_BATCH_MS, commitLagMs, slowBatchReport };
