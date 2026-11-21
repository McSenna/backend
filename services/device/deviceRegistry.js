"use strict";

const Device = require("../../models/Device");
const logger = require("../../utils/logger");
const { detectBrowserSignal } = require("../platformService");
const { readDeviceClaim } = require("./clientDevicePayload");
const { buildDeviceSnapshot, noDeviceSnapshot } = require("./deviceSnapshot");

const CACHE_LIMIT = 1000;
const cache = new Map();

const keyOf = (claim) => `${claim.installId}:${claim.hash}`;

// Insertion order makes the Map a small LRU: a hit moves to the end, the oldest goes first.
const remember = (claim, info) => {
  const key = keyOf(claim);
  cache.delete(key);
  cache.set(key, info);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
};

const recall = (claim) => {
  const key = keyOf(claim);
  if (!cache.has(key)) return undefined;
  const info = cache.get(key);
  remember(claim, info);
  return info;
};

/** Stores a full report. Same key, same content: an existing row only gets its lastSeenAt moved. */
const storeReport = async (claim, now = new Date()) => {
  await Device.updateOne(
    { installId: claim.installId, hash: claim.hash },
    { $setOnInsert: { info: claim.info, firstSeenAt: now }, $set: { lastSeenAt: now } },
    { upsert: true },
  );
};

/** Middleware: reads the headers once and stores a full report without holding up the request. */
const attachDeviceClaim = (req, _res, next) => {
  try {
    req.deviceClaim = readDeviceClaim(req);
  } catch {
    req.deviceClaim = null;
  }
  const claim = req.deviceClaim;
  if (claim?.info) {
    remember(claim, claim.info);
    storeReport(claim).catch((error) => logger.warn("Device report not stored", { errorName: error?.name }));
  }
  next();
};

const lookupReport = async (claim) => {
  const cached = recall(claim);
  if (cached !== undefined) return cached;
  const row = await Device.findOne({ installId: claim.installId, hash: claim.hash }).select("info").lean();
  const info = row?.info ?? null;
  if (info) remember(claim, info);
  return info;
};

const resolveClaim = async (req) => {
  const claim = req.deviceClaim === undefined ? readDeviceClaim(req) : req.deviceClaim;
  if (!claim || claim.info || !claim.hash) return claim;
  return { ...claim, info: await lookupReport(claim) };
};

/**
 * The snapshot for an audit entry. Never throws and never blocks the action:
 * if anything fails, the entry gets the server's own reading of the request.
 */
const resolveLogDevice = async (req, now = new Date()) => {
  if (!req?.headers) return noDeviceSnapshot(now);
  const userAgent = req.headers["user-agent"];
  const hasBrowserSignal = Boolean(detectBrowserSignal(req));
  try {
    const claim = await resolveClaim(req);
    return buildDeviceSnapshot({ claim, userAgent, headers: req.headers, hasBrowserSignal, now });
  } catch (error) {
    logger.warn("Device lookup failed; logging the server reading", { errorName: error?.name });
    return buildDeviceSnapshot({ claim: null, userAgent, headers: req.headers, hasBrowserSignal, now });
  }
};

module.exports = { attachDeviceClaim, resolveLogDevice, storeReport, _cache: cache };
