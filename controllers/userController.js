"use strict";

const User = require("../models/User");
const ResidentVerification = require("../models/ResidentVerification");
const { VALID_STATUSES, resolveUserStatus } = require("../models/User");
const { SIGN_IN_READY_STATUSES } = require("../models/user/userStatus");
const { approve: approveVerification } = require("../services/userRequest/verificationDecisionService");
const { createSystemLog } = require("../services/systemLogService");
const { describePlatformAccess } = require("../config/platformAccess");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS, ERROR_CODES } = require("../utils/errorCodes");
const { isValidObjectId } = require("../utils/objectId");
const { badRequest, forbidden, notFound } = require("../utils/AppError");

const serializeUser = (user) => ({
  ...user,
  phone: user.phone || "",
  status: resolveUserStatus(user),
  platformAccess: describePlatformAccess(user.role),
  lastLogin: user.lastLogin || null,
});

exports.getAllUsers = asyncHandler(async (_req, res) => {
  const users = await User.find({})
    .select("-password")
    .sort({ createdAt: -1 })
    .lean();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Users loaded successfully.",
    count: users.length,
    users: users.map(serializeUser),
  });
});

// One entry per VALID_STATUSES value; the admin UI sends "approved" and
// "deactivated" for residents, which used to produce "User undefined successfully."
const STATUS_VERBS = {
  active: "activated",
  approved: "approved",
  inactive: "deactivated",
  deactivated: "deactivated",
  pending: "set to pending",
  suspended: "suspended",
  rejected: "rejected",
};

// Approving a resident from the Users screen skips the ID-review queue, so close
// the pending verification the same way the review flow would. Otherwise the
// request stays in the queue and can later be "rejected" on an approved account.
const approvePendingVerification = async (userId, adminId) => {
  const pending = await ResidentVerification.findOne({
    user: userId,
    verificationStatus: "pending",
  })
    .select("_id")
    .lean();
  if (pending) await approveVerification({ id: pending._id, adminId });
};

exports.updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!isValidObjectId(id)) {
    throw badRequest("A valid user id is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  const nextStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!VALID_STATUSES.includes(nextStatus)) {
    throw badRequest(
      `Status must be one of: ${VALID_STATUSES.join(", ")}.`,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const actorId = String(req.user?.userId || req.user?._id || "");
  if (actorId && actorId === String(id) && nextStatus !== "active") {
    throw forbidden(
      "You cannot change your own account status.",
      ERROR_CODES.FORBIDDEN
    );
  }

  const existing = await User.findById(id).select("fullname email role status verified").lean();
  if (!existing) {
    throw notFound("User not found.", ERROR_CODES.USER_NOT_FOUND);
  }

  const previousStatus = resolveUserStatus(existing);
  const makesSignInReady = SIGN_IN_READY_STATUSES.includes(nextStatus);

  if (makesSignInReady && existing.role === "resident") {
    await approvePendingVerification(existing._id, actorId);
  }

  const user = await User.findByIdAndUpdate(
    id,
    { $set: makesSignInReady ? { status: nextStatus, verified: true } : { status: nextStatus } },
    { returnDocument: "after", runValidators: true }
  )
    .select("-password")
    .lean();

  if (!user) {
    throw notFound("User not found.", ERROR_CODES.USER_NOT_FOUND);
  }

  await createSystemLog({
    req,
    action: "USER_STATUS_CHANGED",
    role: req.user?.role,
    description: `Admin ${STATUS_VERBS[nextStatus]} the account of ${user.fullname}`,
    resource: "User",
    resourceId: String(user._id),
    metadata: {
      targetUserId: String(user._id),
      targetEmail: user.email,
      previousStatus,
      newStatus: nextStatus,
    },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `User ${STATUS_VERBS[nextStatus]} successfully.`,
    user: serializeUser(user),
  });
});
