"use strict";

const Policy = require("../models/ResidentWebPolicy");
const User = require("../models/User");
const { resolveUserStatus, SIGN_IN_READY_STATUSES } = require("../models/user/userStatus");
const { conflict } = require("../utils/AppError");
const { runInTransaction } = require("./inventory/transactionRunner");
const { accessView, readPolicy } = require("./residentWebAccess");
const { createRequiredSystemLog } = require("./systemLogService");

const statusOf = (enabled) => (enabled ? "on" : "off");
const OVERRIDE_CONFLICT = "This resident's setting changed in another session. Reload it and try again.";
const GLOBAL_CONFLICT = "This setting changed in another session. Reload it and try again.";
const DUPLICATE_KEY = 11000;

const revisionFilter = (revision) =>
  revision === 0
    ? { $or: [{ webAccessRevision: 0 }, { webAccessRevision: { $exists: false } }] }
    : { webAccessRevision: revision };

/**
 * Applies one resident's setting. The update and its audit entry commit together, so a
 * failed audit leaves the setting untouched. Repeating the current value writes nothing.
 */
const changeResidentAccess = async ({ req, resident, override, revision, reason }) => {
  const current = resident.residentWebAccessOverride ?? null;
  if (current === override) {
    return { user: resident, access: accessView(resident, await readPolicy()), changed: false };
  }
  return runInTransaction(async (session) => {
    const policy = await Policy.findById("resident-web").session(session).lean();
    const before = await User.findOneAndUpdate(
      { _id: resident._id, role: "resident", ...revisionFilter(revision) },
      { $set: { residentWebAccessOverride: override }, $inc: { webAccessRevision: 1 } },
      { returnDocument: "before", runValidators: true, session },
    ).lean();
    if (!before) throw conflict(OVERRIDE_CONFLICT);
    const user = { ...before, residentWebAccessOverride: override, webAccessRevision: (before.webAccessRevision ?? 0) + 1 };
    const previous = accessView(before, policy);
    const access = accessView(user, policy);
    await createRequiredSystemLog({
      req,
      session,
      action: "RESIDENT_WEB_ACCESS_CHANGED",
      description: "Designated administrator changed a resident's web access",
      resource: "User",
      resourceId: String(user._id),
      metadata: {
        residentId: String(user._id),
        previousStatus: previous.status,
        newStatus: access.status,
        previousOverride: previous.override,
        newOverride: override,
        reason,
        revision: user.webAccessRevision,
      },
    });
    return { user, access, changed: true };
  }, { required: true });
};

/** Residents with no individual setting and an active account are the ones a global change moves. */
const residentsFollowingGlobal = async (session) => {
  const candidates = await User.find({ role: "resident", residentWebAccessOverride: null })
    .select("_id status verified")
    .session(session)
    .lean();
  return candidates
    .filter((user) => SIGN_IN_READY_STATUSES.includes(resolveUserStatus(user)))
    .map((user) => String(user._id));
};

const writeGlobal = async ({ enabled, revision, actorId, session }) => {
  const before = await Policy.findOneAndUpdate(
    { _id: "resident-web", revision },
    { $set: { enabled, updatedBy: actorId }, $inc: { revision: 1 } },
    { returnDocument: "before", runValidators: true, session },
  ).lean();
  if (before) return { previousEnabled: before.enabled === true, nextRevision: before.revision + 1 };
  // A missing policy can be restored from revision 0. Any other miss is a stale save.
  if (revision !== 0 || (await Policy.exists({ _id: "resident-web" }).session(session))) throw conflict(GLOBAL_CONFLICT);
  try {
    await Policy.create([{ _id: "resident-web", enabled, revision: 1, updatedBy: actorId }], { session });
  } catch (error) {
    if (error.code === DUPLICATE_KEY) throw conflict(GLOBAL_CONFLICT);
    throw error;
  }
  return { previousEnabled: false, nextRevision: 1 };
};

const changeGlobalAccess = async ({ req, enabled, revision, reason }) => {
  const current = await readPolicy();
  if (current && current.enabled === enabled) return { policy: current, changed: false };
  return runInTransaction(async (session) => {
    const { previousEnabled, nextRevision } = await writeGlobal({ enabled, revision, actorId: req.user.userId, session });
    const affectedResidentIds = await residentsFollowingGlobal(session);
    await createRequiredSystemLog({
      req,
      session,
      action: "RESIDENT_WEB_POLICY_CHANGED",
      description: "Designated administrator changed global resident web access",
      resource: "ResidentWebPolicy",
      resourceId: "resident-web",
      metadata: {
        previousStatus: statusOf(previousEnabled),
        newStatus: statusOf(enabled),
        affectedResidentIds,
        affectedCount: affectedResidentIds.length,
        reason,
        revision: nextRevision,
      },
    });
    return { policy: { enabled, revision: nextRevision }, changed: true };
  }, { required: true });
};

module.exports = { changeResidentAccess, changeGlobalAccess };
