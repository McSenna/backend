"use strict";
const Policy = require("../models/ResidentWebPolicy");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { badRequest, conflict, notFound } = require("../utils/AppError");
const { isValidObjectId } = require("../utils/objectId");
const {
  readPolicy,
  policyView,
  accessView,
} = require("../services/residentWebAccess");
const { createSystemLog } = require("../services/systemLogService");
const { resync } = require("../realtime/broadcast");
const { adminRoom } = require("../realtime/rooms");
const { disconnectResidentWeb, recheckResidentWeb } = require("../realtime/residentAuthorization");

const validRevision = (revision) => Number.isSafeInteger(revision) && revision >= 0;
const validateGlobalChange = (body = {}) => {
  if (typeof body.enabled !== "boolean" || !validRevision(body.revision))
    throw badRequest(
      "Provide enabled as a boolean and the current revision. Reload the setting and try again.",
    );
};
const validateOverrideChange = (body = {}) => {
  if (!["allow", "block", null].includes(body.override) || !validRevision(body.revision))
    throw badRequest(
      "Provide override as allow, block or null, and the current revision. Reload the setting and try again.",
    );
};
const resident = async (id) => {
  if (!isValidObjectId(id))
    throw badRequest("A valid resident id is required.");
  const user = await User.findOne({ _id: id, role: "resident" }).lean();
  if (!user) throw notFound("Resident account not found.");
  return user;
};
exports.getGlobal = asyncHandler(async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, policy: policyView(await readPolicy()) });
});
exports.setGlobal = asyncHandler(async (req, res) => {
  validateGlobalChange(req.body);
  const { enabled, revision } = req.body;
  let policy = await Policy.findOneAndUpdate(
    { _id: "resident-web", revision },
    { $set: { enabled, updatedBy: req.user.userId }, $inc: { revision: 1 } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!policy && revision === 0) {
    try {
      policy = await Policy.create({
        _id: "resident-web",
        enabled,
        revision: 1,
        updatedBy: req.user.userId,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  if (!policy)
    throw conflict(
      "This setting changed in another session. Reload it and try again.",
    );
  // Residents with an allow override keep access, so each web socket is rechecked rather than dropped.
  if (!enabled) await recheckResidentWeb();
  await createSystemLog({
    req,
    action: "RESIDENT_WEB_POLICY_CHANGED",
    description: "Admin changed global resident web access",
    resource: "ResidentWebPolicy",
    resourceId: "resident-web",
    metadata: {
      enabled,
      previousRevision: revision,
      revision: policy.revision,
    },
  });
  resync("user", [adminRoom()]);
  res.set("Cache-Control", "no-store");
  res.json({ success: true, policy: policyView(policy) });
});
exports.getIndividual = asyncHandler(async (req, res) => {
  const user = await resident(req.params.id);
  res.set("Cache-Control", "no-store");
  res.json({ success: true, access: accessView(user, await readPolicy()) });
});
exports.setIndividual = asyncHandler(async (req, res) => {
  validateOverrideChange(req.body);
  await resident(req.params.id);
  const { override, revision } = req.body;
  const version =
    revision === 0
      ? {
          $or: [
            { webAccessRevision: 0 },
            { webAccessRevision: { $exists: false } },
          ],
        }
      : { webAccessRevision: revision };
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: "resident", ...version },
    {
      $set: { residentWebAccessOverride: override },
      $inc: { webAccessRevision: 1 },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!user)
    throw conflict(
      "This resident's setting changed in another session. Reload it and try again.",
    );
  const access = accessView(user, await readPolicy());
  if (!access.effective) disconnectResidentWeb(String(user._id));
  await createSystemLog({
    req,
    action: "RESIDENT_WEB_ACCESS_CHANGED",
    description: "Admin changed individual resident web access",
    resource: "User",
    resourceId: String(user._id),
    metadata: {
      override,
      previousRevision: revision,
      revision: user.webAccessRevision,
    },
  });
  res.set("Cache-Control", "no-store");
  resync("user", [adminRoom()]);
  res.json({ success: true, access });
});
exports.resident = resident;
