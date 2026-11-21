"use strict";

const jwt = require("jsonwebtoken");

const AuthSession = require("../../models/AuthSession");
const User = require("../../models/User");
const logger = require("../../utils/logger");

const OS_PATTERNS = [[/Android/, "Android"], [/iPhone|iPad/, "iOS"], [/Windows/, "Windows"], [/Mac OS X/, "macOS"], [/CrOS/, "ChromeOS"], [/Linux/, "Linux"]];
const BROWSER_PATTERNS = [[/Edg\//, "Edge"], [/OPR\//, "Opera"], [/Firefox\//, "Firefox"], [/Chrome\//, "Chrome"], [/Safari\//, "Safari"]];

/** "Linux · Chrome", the same words the web app shows for its own browser. Null when neither part is recognised. */
function describeDevice(userAgent) {
  const agent = String(userAgent || "").slice(0, 512);
  const os = OS_PATTERNS.find(([pattern]) => pattern.test(agent))?.[1];
  const browser = BROWSER_PATTERNS.find(([pattern]) => pattern.test(agent))?.[1];
  if (!os && !browser) return null;
  return [os, browser].filter(Boolean).join(" · ");
}

/**
 * Records (or, after a password change re-issues the token, refreshes) the
 * session a token belongs to. Best effort: a sign-in never fails because this
 * bookkeeping did; the session simply goes uncounted.
 */
async function recordSession({ user, sessionId, platform, token, req }) {
  try {
    const exp = jwt.decode(token)?.exp;
    await AuthSession.updateOne(
      { sessionId },
      {
        $set: {
          user: user._id,
          platform,
          tokenVersion: user.tokenVersion ?? 0,
          expiresAt: new Date((exp ?? Math.floor(Date.now() / 1000) + 7 * 86400) * 1000),
        },
        $setOnInsert: { device: describeDevice(req?.get?.("user-agent")), endedAt: null },
      },
      { upsert: true },
    );
  } catch (error) {
    logger.warn("Session not recorded", { errorName: error?.name });
  }
}

/** Sessions that can still make requests: not logged out, not expired, issued since the last revocation. */
async function listActiveSessions(userId) {
  const account = await User.findById(userId).select("tokenVersion").lean();
  if (!account) return [];
  return AuthSession.find({
    user: userId,
    endedAt: null,
    expiresAt: { $gt: new Date() },
    tokenVersion: account.tokenVersion ?? 0,
  })
    .select("sessionId platform device createdAt")
    .sort({ createdAt: -1 })
    .lean();
}

async function endSession(sessionId) {
  if (!sessionId) return;
  await AuthSession.updateOne({ sessionId, endedAt: null }, { $set: { endedAt: new Date() } });
}

/**
 * Ends every session of the account. The tokenVersion bump is what actually
 * revokes them: the auth middleware refuses any token issued before it.
 */
async function endAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await AuthSession.updateMany({ user: userId, endedAt: null }, { $set: { endedAt: new Date() } });
}

module.exports = { describeDevice, recordSession, listActiveSessions, endSession, endAllSessions };
