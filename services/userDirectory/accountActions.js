"use strict";

const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const { resolveUserStatus } = require("../../models/user/userStatus");
const { badRequest, conflict, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { createSystemLog } = require("../systemLogService");
const { readRejection } = require("../userRequest/verificationDecisionService");
const { assertTransition } = require("./accountLifecycle");
const { assertAdminChangeAllowed, assertAdminRemains } = require("./adminGuards");

const staleRow = () =>
  conflict("This account changed and that action no longer applies. Reload the list and try again.", ERROR_CODES.INVALID_TRANSITION);

const assertNoIdReview = async (userId) => {
  if (await ResidentVerification.exists({ user: userId })) {
    throw conflict("This request has an ID on file. Open the ID review to decide it.", ERROR_CODES.USE_ID_REVIEW);
  }
};

/** Puts a deactivated account back as it was; an account with no stored status gets none back. */
const undoDeactivation = (previous) => {
  const cleared = { deactivated_by: null, deactivated_at: null };
  return previous.status == null
    ? { $set: cleared, $unset: { status: "" } }
    : { $set: { ...cleared, status: previous.status } };
};

const ACTIONS = {
  deactivate: {
    target: "deactivated",
    log: "USER_STATUS_CHANGED",
    verb: "deactivated",
    guard: ({ actorId, user }) => assertAdminChangeAllowed({ actorId, target: user }),
    fields: ({ actorId, now }) => ({ deactivated_by: actorId, deactivated_at: now }),
  },
  reactivate: {
    target: "active",
    log: "USER_STATUS_CHANGED",
    verb: "reactivated",
    guard: ({ actorId, user }) => assertAdminChangeAllowed({ actorId, target: user }),
    fields: () => ({ verified: true, deactivated_by: null, deactivated_at: null }),
  },
  approve: {
    target: "approved",
    log: "USER_APPROVED",
    verb: "approved",
    guard: ({ user }) => assertNoIdReview(user._id),
    fields: ({ actorId, now }) => ({
      verified: true,
      approved_by: actorId,
      approved_at: now,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: "",
      rejection_remarks: "",
    }),
  },
  reject: {
    target: "rejected",
    log: "USER_REJECTED",
    verb: "rejected",
    guard: ({ user }) => assertNoIdReview(user._id),
    fields: ({ actorId, now, body }) => {
      const { reason, remarks } = readRejection(body.reason, body.remarks);
      return { rejected_by: actorId, rejected_at: now, rejection_reason: reason, rejection_remarks: remarks };
    },
  },
};

/** Moves one account through the lifecycle; returns the saved account. */
const applyStatusAction = async ({ req, id, body = {} }) => {
  if (!isValidObjectId(id)) throw badRequest("A valid user id is required.", ERROR_CODES.VALIDATION_ERROR);
  const action = ACTIONS[body.action];
  if (!action) throw badRequest("Action must be deactivate, reactivate, approve or reject.", ERROR_CODES.VALIDATION_ERROR);

  const user = await User.findById(id).select("fullname email role status verified").lean();
  if (!user) throw notFound("User not found.", ERROR_CODES.USER_NOT_FOUND);

  const actorId = String(req.user.userId);
  const previousStatus = resolveUserStatus(user);
  await action.guard({ actorId, user });
  assertTransition(previousStatus, action.target);

  const fields = action.fields({ actorId, now: new Date(), body });
  // The filter makes a second click, or another admin's change, a clean 409.
  const saved = await User.findOneAndUpdate(
    { _id: id, status: user.status ?? null },
    { $set: { status: action.target, ...fields } },
    { returnDocument: "after", runValidators: true },
  )
    .select("-password")
    .lean();
  if (!saved) throw staleRow();

  if (body.action === "deactivate" && user.role === "admin") {
    await assertAdminRemains(() => User.updateOne({ _id: id }, undoDeactivation(user)));
  }

  await createSystemLog({
    req,
    action: action.log,
    role: req.user.role,
    description: `Admin ${action.verb} the account of ${saved.fullname}`,
    resource: "User",
    resourceId: String(saved._id),
    metadata: { targetUserId: String(saved._id), targetEmail: saved.email, previousStatus, newStatus: action.target },
  });
  return saved;
};

module.exports = { applyStatusAction, undoDeactivation };
