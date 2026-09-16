"use strict";

const User = require("../models/User");
const { buildUserResponse } = require("../services/auth/authResponse");
const { createSystemLog } = require("../services/systemLogService");
const { normalizeProfilePhoto } = require("../utils/profilePhoto");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS, ERROR_CODES } = require("../utils/errorCodes");
const { badRequest, notFound } = require("../utils/AppError");
const {
  isValidFullName,
  isValidAddress,
  isValidPhMobile,
  normalizePhMobile,
} = require("../utils/validation");

const EDITABLE_FIELDS = ["fullname", "phone", "address", "profilePhoto"];

const buildProfileUpdate = (body) => {
  const update = {};

  if ("fullname" in body) {
    const fullname = String(body.fullname ?? "").trim();
    if (!isValidFullName(fullname)) {
      throw badRequest("Full name must be between 2 and 100 characters.", ERROR_CODES.VALIDATION_ERROR);
    }
    update.fullname = fullname;
  }

  if ("phone" in body) {
    const phone = String(body.phone ?? "").trim();
    if (phone && !isValidPhMobile(phone)) {
      throw badRequest("Please provide a valid PH mobile number.", ERROR_CODES.VALIDATION_ERROR);
    }
    update.phone = phone ? normalizePhMobile(phone) : "";
  }

  if ("address" in body) {
    const address = String(body.address ?? "").trim();
    if (!isValidAddress(address)) {
      throw badRequest("Address must be between 5 and 255 characters.", ERROR_CODES.VALIDATION_ERROR);
    }
    update.address = address;
  }

  if ("profilePhoto" in body) {
    const normalized = normalizeProfilePhoto(body.profilePhoto);
    if (!normalized.ok) {
      throw badRequest(normalized.message, ERROR_CODES.INVALID_PHOTO);
    }
    update.profilePhoto = normalized.profilePhoto;
  }

  return update;
};

exports.getMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId).select("-password").lean();
  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    user: buildUserResponse(user),
  });
});

exports.updateMyProfile = asyncHandler(async (req, res) => {
  const requestedFields = Object.keys(req.body || {}).filter((key) =>
    EDITABLE_FIELDS.includes(key)
  );

  if (requestedFields.length === 0) {
    throw badRequest("No editable fields were provided.", ERROR_CODES.VALIDATION_ERROR);
  }

  const update = buildProfileUpdate(req.body);

  const user = await User.findByIdAndUpdate(
    req.user.userId,
    { $set: update },
    { new: true, runValidators: true }
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
