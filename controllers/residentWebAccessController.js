"use strict";
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { badRequest, notFound } = require("../utils/AppError");
const { isValidObjectId } = require("../utils/objectId");
const {
  readPolicy,
  policyView,
  accessView,
} = require("../services/residentWebAccess");
const { changeGlobalAccess, changeResidentAccess } = require("../services/residentWebAccessChange");
const { resync } = require("../realtime/broadcast");
const { adminRoom } = require("../realtime/rooms");
const { disconnectResidentWeb, recheckResidentWeb } = require("../realtime/residentAuthorization");

const validRevision = (revision) => Number.isSafeInteger(revision) && revision >= 0;
const REASON_MAX_LENGTH = 300;
const readReason = ({ reason } = {}) => {
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== "string" || reason.trim().length > REASON_MAX_LENGTH)
    throw badRequest(`Keep the reason to ${REASON_MAX_LENGTH} characters of plain text, or leave it empty.`);
  return reason.trim() || null;
};
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
  const { policy, changed } = await changeGlobalAccess({ req, enabled, revision, reason: readReason(req.body) });
  if (changed) {
    // Residents with an allow override keep access, so each web socket is rechecked rather than dropped.
    if (!enabled) await recheckResidentWeb();
    resync("user", [adminRoom()]);
  }
  res.set("Cache-Control", "no-store");
  res.json({ success: true, changed, policy: policyView(policy) });
});
exports.getIndividual = asyncHandler(async (req, res) => {
  const user = await resident(req.params.id);
  res.set("Cache-Control", "no-store");
  res.json({ success: true, access: accessView(user, await readPolicy()) });
});
exports.setIndividual = asyncHandler(async (req, res) => {
  validateOverrideChange(req.body);
  const { override, revision } = req.body;
  const reason = readReason(req.body);
  const { user, access, changed } = await changeResidentAccess({
    req,
    resident: await resident(req.params.id),
    override,
    revision,
    reason,
  });
  if (changed) {
    if (!access.effective) disconnectResidentWeb(String(user._id));
    resync("user", [adminRoom()]);
  }
  res.set("Cache-Control", "no-store");
  res.json({ success: true, changed, access });
});
exports.resident = resident;
