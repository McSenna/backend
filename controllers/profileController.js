"use strict";

const User = require("../models/User");
const { buildUserResponse } = require("../services/auth/authResponse");
const { EDITABLE_FIELDS, buildProfileUpdate } = require("../services/profile/profileUpdateBuilder");
const { createSystemLog } = require("../services/systemLogService");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS, ERROR_CODES } = require("../utils/errorCodes");
const { badRequest, notFound } = require("../utils/AppError");

const loadOwnAccount = async (userId) => {
  const user = await User.findById(userId).select("-password").lean();
  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }
  return user;
};

exports.getMyProfile = asyncHandler(async (req, res) => {
  const user = await loadOwnAccount(req.user.userId);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    user: buildUserResponse(user),
  });
});

exports.updateMyProfile = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const requestedFields = Object.keys(body).filter((key) => EDITABLE_FIELDS.includes(key));

  if (requestedFields.length === 0) {
    throw badRequest("No editable fields were provided.", ERROR_CODES.VALIDATION_ERROR);
  }

  const current = await loadOwnAccount(req.user.userId);
  const update = buildProfileUpdate(body, current);

  const user = await User.findByIdAndUpdate(
    req.user.userId,
    { $set: update },
    { returnDocument: "after", runValidators: true }
  )
    .select("-password")
    .lean();

  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  await createSystemLog({
    req,
    action: "USER_UPDATED",
    role: req.user.role,
    description: `${user.fullname} updated their profile`,
    resource: "User",
    resourceId: String(user._id),
    metadata: { fields: Object.keys(update) },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Profile updated successfully.",
    user: buildUserResponse(user),
  });
});
