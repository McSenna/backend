"use strict";
const Notification = require("../../models/Notification");
const Device = require("../../models/PushDevice");
const Delivery = require("../../models/PushDelivery");
const User = require("../../models/User");
const logger = require("../../utils/logger");
const { randomUUID } = require("crypto");
const BASE = "https://exp.host/--/api/v2/push";
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TTL_SECONDS = 3 * 24 * 60 * 60;

async function enqueue() {
  const rows = await Notification.find({ pushQueued: false }).sort({ createdAt: 1 }).limit(20).select("_id recipient").lean();
  for (const row of rows) {
    const devices = await Device.find({ user: row.recipient, active: true, expiresAt: { $gt: new Date() } }).select("_id sessionId").limit(100).lean();
    if (devices.length) {
      try {
        await Delivery.bulkWrite(devices.map(device => ({ updateOne: {
          filter: { notification: row._id, device: device._id },
          update: { $setOnInsert: { user: row.recipient, sessionId: device.sessionId, state: "pending", nextAt: new Date(), attempts: 0 } },
          upsert: true,
        } })), { ordered: false });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    await Notification.updateOne({ _id: row._id }, { $set: { pushQueued: true } });
  }
}

async function expoRequest(path, body, fetchImpl) {
  const response = await fetchImpl(`${BASE}/${path}`, {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Accept: "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error(`ExpoHTTP${response.status}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const result = await response.json();
  if (!result || !result.data || result.errors?.length) throw new Error("InvalidExpoResponse");
  return result.data;
}

async function fail(job, code, retryable) {
  const retry = retryable && job.attempts < 5 && Date.now() - job.createdAt.getTime() < 86400000;
  await Delivery.updateOne({ _id: job._id, state: job.state, nextAt: job.nextAt }, { $set: {
    state: retry ? "pending" : "failed", lastError: code,
    nextAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** job.attempts) + Math.random() * 1000),
  } });
  logger.warn("Push delivery attempt failed", { deliveryId: String(job._id), code, retry, attempts: job.attempts });
}

async function perform(job, fetchImpl) {
  const device = await Device.findOne({ _id: job.device, user: job.user, sessionId: job.sessionId, active: true, expiresAt: { $gt: new Date() } }).select("+pushToken").lean();
  const accountRow = device && await User.findOne({ _id: job.user,
    tokenVersion: device.tokenVersion === 0 ? { $in: [0, null] } : device.tokenVersion,
  }).select("_id status verified role").lean();
  // Match authentication's legacy-status fallback and blocked-account policy.
  const account = accountRow && !User.BLOCKED_STATUSES.includes(User.resolveUserStatus(accountRow)) ? accountRow : null;
  const notification = account && await Notification.exists({ _id: job.notification, recipient: job.user });
  if (!device || !account || !notification) return fail(job, "AssociationEnded", false);
  try {
    let ticket;
    if (job.state === "checking") {
      const receipts = await expoRequest("getReceipts", { ids: [job.receiptId] }, fetchImpl);
      ticket = receipts[job.receiptId];
      if (!ticket) {
        if (Date.now() - job.receiptStartedAt.getTime() > 86400000) return fail(job, "ReceiptExpired", false);
        await Delivery.updateOne({ _id: job._id, state: job.state, nextAt: job.nextAt }, { $set: { state: "receipt", nextAt: new Date(Date.now() + FIFTEEN_MINUTES) } });
        return;
      }
    } else {
      ticket = await expoRequest("send", {
        to: device.pushToken, title: "MaslogCare", body: "Open MaslogCare to view your notification.",
        sound: "default", channelId: "maslogcare-default", priority: "high", ttl: TTL_SECONDS,
        data: { version: 1, destination: "notifications", notificationId: String(job.notification), recipientId: String(job.user) },
      }, fetchImpl);
    }
    if (ticket.status === "error") {
      const code = typeof ticket.details?.error === "string" ? ticket.details.error : "ExpoRejected";
      if (code === "DeviceNotRegistered") {
        // A stale receipt must not disable a refreshed token or another account.
        await Device.updateOne({ _id: device._id, pushToken: job.state === "checking" ? job.sentToken : device.pushToken, user: job.user, sessionId: job.sessionId }, { $set: { active: false } });
      }
      return fail(job, code, code === "MessageRateExceeded");
    }
    if (ticket.status !== "ok" || (job.state === "sending" && typeof ticket.id !== "string")) throw new Error("InvalidExpoTicket");
    const state = job.state === "checking" ? "accepted" : "receipt";
    await Delivery.updateOne({ _id: job._id, state: job.state, nextAt: job.nextAt }, { $set: {
      state, lastError: null, ...(state === "receipt" ? { sentToken: device.pushToken, receiptId: ticket.id, receiptStartedAt: new Date(), nextAt: new Date(Date.now() + FIFTEEN_MINUTES) } : {}),
    } });
    logger.info("Push status updated", { deliveryId: String(job._id), state });
  } catch (error) {
    if (job.state === "checking" && error.retryable !== false && Date.now() - job.receiptStartedAt.getTime() < 86400000) {
      await Delivery.updateOne({ _id: job._id, state: job.state, nextAt: job.nextAt }, { $set: { state: "receipt", nextAt: new Date(Date.now() + FIFTEEN_MINUTES), lastError: "ReceiptLookupFailed" } });
      logger.warn("Push receipt lookup deferred", { deliveryId: String(job._id) });
    } else await fail(job, error.retryable === false ? error.message : "ExpoUnavailable", error.retryable !== false);
  }
}

async function runPushCycle({ fetchImpl = fetch } = {}) {
  await enqueue();
  for (let i = 0; i < 20; i++) {
    const now = new Date();
    const job = await Delivery.findOneAndUpdate({ state: { $in: ["pending", "sending", "receipt", "checking"] }, nextAt: { $lte: now } }, [
      { $set: { state: { $cond: [{ $in: ["$state", ["receipt", "checking"]] }, "checking", "sending"] },
        attempts: { $cond: [{ $in: ["$state", ["receipt", "checking"]] }, "$attempts", { $add: ["$attempts", 1] }] },
        nextAt: new Date(Date.now() + 60_000) } },
    ], { returnDocument: "after", sort: { nextAt: 1 }, updatePipeline: true }).select("+sentToken").lean();
    if (!job) break;
    await perform(job, fetchImpl);
  }
}

function startPushWorker() {
  if (process.env.EXPO_PUSH_ENABLED !== "true") return () => {};
  let stopped = false;
  let timer;
  const tick = async () => {
    try { await runPushCycle(); }
    catch (error) { logger.error("Push worker cycle failed", { errorName: error.name }); }
    if (!stopped) timer = setTimeout(tick, 5000).unref();
  };
  void tick();
  logger.info("Expo push worker enabled", { workerId: randomUUID() });
  return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { runPushCycle, startPushWorker };
