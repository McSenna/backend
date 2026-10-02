"use strict";

const User = require("../../models/User");
const asyncHandler = require("../../utils/asyncHandler");
const { createSystemLog } = require("../../services/systemLogService");
const { resolveUserStatus, SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");
const { STATUS_GROUPS } = require("../../services/userDirectory/userListQuery");
const { HTTP_STATUS, ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { badRequest } = require("../../utils/AppError");

const MAX_IDS = 100;

// Residents use approved/deactivated and staff use active/inactive, the same
// pairs the single-user status endpoint sends.
const ACTIONS = {
  deactivate: {
    from: [...STATUS_GROUPS.active, ...STATUS_GROUPS.approved],
    to: (role) => (role === "resident" ? "deactivated" : "inactive"),
    verb: "deactivated",
  },
  reactivate: {
    from: STATUS_GROUPS.deactivated,
    to: (role) => (role === "resident" ? "approved" : "active"),
    verb: "reactivated",
  },
};

const readIds = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    throw badRequest(`Send between 1 and ${MAX_IDS} user ids.`, ERROR_CODES.VALIDATION_ERROR);
  }
  const unique = [...new Set(ids.map(String))];
  if (!unique.every(isValidObjectId)) {
    throw badRequest("Every user id must be valid.", ERROR_CODES.VALIDATION_ERROR);
  }
  return unique;
};

/**
 * PATCH /users/status { ids, action }. Accounts already in the target state,
 * and the admin's own account, are skipped rather than failing the batch.
 */
exports.updateUsersStatus = asyncHandler(async (req, res) => {
  const action = ACTIONS[req.body?.action];
  if (!action) {
    throw badRequest("Action must be deactivate or reactivate.", ERROR_CODES.VALIDATION_ERROR);
  }

  const actorId = String(req.user?.userId || req.user?._id || "");
  const ids = readIds(req.body.ids).filter((id) => id !== actorId);

  const users = await User.find({ _id: { $in: ids } }).select("fullname email role status verified").lean();
  const eligible = users.filter((user) => action.from.includes(resolveUserStatus(user)));

  for (const user of eligible) {
    const nextStatus = action.to(user.role);
    // Same as the single-user endpoint: a sign-in-ready status also marks the account verified.
    const update = SIGN_IN_READY_STATUSES.includes(nextStatus)
      ? { status: nextStatus, verified: true }
      : { status: nextStatus };
    await User.updateOne({ _id: user._id }, { $set: update }, { runValidators: true });
    await createSystemLog({
      req,
      action: "USER_STATUS_CHANGED",
      role: req.user?.role,
      description: `Admin ${action.verb} the account of ${user.fullname}`,
      resource: "User",
      resourceId: String(user._id),
      metadata: {
        targetUserId: String(user._id),
        targetEmail: user.email,
        previousStatus: resolveUserStatus(user),
        newStatus: nextStatus,
      },
    });
  }

  const updatedIds = eligible.map((user) => String(user._id));
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `${updatedIds.length} ${updatedIds.length === 1 ? "user" : "users"} ${action.verb}.`,
    updatedIds,
    skippedIds: req.body.ids.map(String).filter((id) => !updatedIds.includes(id)),
  });
});
