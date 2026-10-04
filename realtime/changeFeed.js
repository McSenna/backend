"use strict";

const logger = require("../utils/logger");
const { resyncEverything } = require("./broadcast");
const { commitLagMs, slowBatchReport } = require("./batchTiming");

const FLUSH_MS = 50;
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
const UNSUPPORTED_TOPOLOGY = 40573;

// Only ids, the kind of change, the names of changed fields and the commit
// time leave the database. Publishers re-read each record through its REST
// query, so the stream never needs the documents themselves.
const PIPELINE = [
  { $match: { operationType: { $in: ["insert", "update", "replace", "delete"] } } },
  {
    $project: {
      operationType: 1,
      documentKey: 1,
      wallTime: 1,
      updatedKeys: {
        $map: { input: { $objectToArray: "$updateDescription.updatedFields" }, in: "$$this.k" },
      },
    },
  },
];

const ACTION_OF = { insert: "created", update: "updated", replace: "updated", delete: "deleted" };

/** Several writes to one record inside a batch collapse into the one that matters. */
const mergeChange = (previous, next) => {
  if (!previous) return next;
  if (next.action === "deleted") return next;
  if (previous.action === "created") return { ...next, action: "created" };
  return { ...next, updatedKeys: [...new Set([...previous.updatedKeys, ...next.updatedKeys])] };
};

const toChange = (event) => ({
  id: String(event.documentKey._id),
  action: ACTION_OF[event.operationType],
  updatedKeys: Array.isArray(event.updatedKeys) ? event.updatedKeys : [],
});

/**
 * Watches one collection for committed writes, from any code path or process,
 * and hands them to its publisher in small batches so a bulk update becomes one
 * re-read instead of hundreds.
 */
const watchCollection = ({ name, model, publish }) => {
  const pending = new Map();
  let flushTimer = null;
  let stream = null;
  let resumeToken = null;
  let attempt = 0;
  let stopped = false;
  // Batches publish one after another, so a slow re-read can never deliver an
  // older version of a record after a newer one.
  let publishing = Promise.resolve();
  // When the oldest change still waiting arrived, for the slow-batch warning.
  let oldestArrival = null;

  const flush = () => {
    flushTimer = null;
    publishing = publishing.then(publishPending);
  };

  const publishPending = async () => {
    const changes = [...pending.values()];
    if (changes.length === 0) return;
    pending.clear();
    const arrival = oldestArrival;
    oldestArrival = null;
    const startedAt = performance.now();
    try {
      await publish(changes);
    } catch (error) {
      logger.error("Realtime: publishing failed", { feed: name, errorName: error?.name, errorMessage: error?.message });
    }
    const slow = arrival && slowBatchReport(arrival, startedAt, performance.now());
    if (slow) logger.warn("Realtime: slow change batch", { feed: name, changes: changes.length, ...slow });
  };

  const onChange = (event) => {
    resumeToken = event._id;
    attempt = 0;
    const change = toChange(event);
    pending.set(change.id, mergeChange(pending.get(change.id), change));
    oldestArrival ??= { receivedAt: performance.now(), lagMs: commitLagMs(event.wallTime) };
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  };

  const open = () => {
    const options = resumeToken ? { resumeAfter: resumeToken } : {};
    stream = model.watch(PIPELINE, options);
    stream.on("change", onChange);
    stream.on("error", onError);
  };

  function onError(error) {
    stream?.removeAllListeners();
    void stream?.close().catch(() => undefined);
    stream = null;
    if (stopped) return;

    if (error?.code === UNSUPPORTED_TOPOLOGY) {
      logger.error("Realtime: change streams need a replica set; live updates are off", { feed: name });
      return;
    }

    // A token too old to resume from means changes may have been missed:
    // start fresh and tell every client to reload what it shows.
    const lostHistory = error?.code === 286 || error?.codeName === "ChangeStreamHistoryLost";
    if (lostHistory) {
      resumeToken = null;
      resyncEverything();
    }

    const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
    attempt += 1;
    logger.warn("Realtime: change stream interrupted; reopening", { feed: name, delayMs: delay, errorName: error?.name });
    setTimeout(() => !stopped && open(), delay).unref();
  }

  open();

  return () => {
    stopped = true;
    if (flushTimer) clearTimeout(flushTimer);
    stream?.removeAllListeners();
    return stream?.close().catch(() => undefined);
  };
};

/** Starts one watcher per registered collection; returns a function that stops them all. */
const startChangeFeed = (registrations) => {
  const stops = registrations.map(watchCollection);
  return () => Promise.all(stops.map((stop) => stop()));
};

module.exports = { startChangeFeed, mergeChange, toChange };
