"use strict";
const PushDevice = require("../../models/PushDevice");
const { badRequest, forbidden } = require("../../utils/AppError");
const logger = require("../../utils/logger");
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z\d_-]{1,200}\]$/;
const FAILURE_CODE = /^[A-Z][A-Z\d_]{2,39}$/;
function input(req, registering) {
  const body = req.body || {};
  const allowed = registering ? ["deviceId", "pushToken", "platform"] : ["deviceId"];
  if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.deviceId !== "string" || !UUID.test(body.deviceId)) {
    throw badRequest("Supply this installation's deviceId UUID; ownership comes from your session.");
  }
  if (req.auth?.platform !== "mobile" || !req.auth.sessionId || !req.user.exp) {
    throw forbidden("Sign in again in the Android app before registering notifications.");
  }
  if (registering && (body.platform !== "android" || typeof body.pushToken !== "string" || !EXPO_TOKEN.test(body.pushToken))) {
    throw badRequest("An Android Expo push token is required.");
  }
  return body;
}
async function register(req) {
  const body = input(req, true);
  const fields = { user: req.user.userId, pushToken: body.pushToken, platform: body.platform,
    sessionId: req.auth.sessionId, tokenVersion: req.user.tokenVersion ?? 0,
    expiresAt: new Date(req.user.exp * 1000), active: true };
  // Unique installation and token indexes make replay safe, including concurrent requests.
  try {
    await PushDevice.updateOne({ deviceId: body.deviceId }, { $set: fields }, { upsert: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    // A restored/reinstalled app can receive the same Expo token with a new local ID.
    await PushDevice.updateOne({ pushToken: body.pushToken }, { $set: { ...fields, deviceId: body.deviceId } }, { runValidators: true });
  }
  logger.info("Push installation registered", { userId: req.user.userId, requestId: req.requestId });
}
async function unregister(req) {
  const body = input(req, false);
  await PushDevice.updateOne({ deviceId: body.deviceId, user: req.user.userId, sessionId: req.auth.sessionId }, { $set: { active: false } });
}
async function releaseSession(user, sessionId) {
  if (sessionId) await PushDevice.updateMany({ user, sessionId }, { $set: { active: false } });
}
// A phone that cannot get a token never reaches register, so this is the only record of why.
function reportFailure(req) {
  const body = req.body || {};
  if (Object.keys(body).length !== 1 || typeof body.code !== "string" || !FAILURE_CODE.test(body.code)) {
    throw badRequest("Supply a push failure code.");
  }
  if (req.auth?.platform !== "mobile") throw forbidden("Sign in again in the Android app before reporting notification problems.");
  logger.warn("Push setup failed on device", { code: body.code, requestId: req.requestId });
}
module.exports = { register, unregister, releaseSession, reportFailure };
