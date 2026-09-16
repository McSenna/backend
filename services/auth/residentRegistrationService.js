"use strict";

const User = require("../../models/User");
const PendingRegistration = require("../../models/register");
const ResidentVerification = require("../../models/ResidentVerification");
const Notification = require("../../models/Notification");
const logger = require("../../utils/logger");
const { normalizeProfilePhoto } = require("../../utils/profilePhoto");
const { badRequest, conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { resolveRegistrationProfile } = require("./registrationProfile");
const { prepareGovernmentId } = require("./governmentIdService");
const { consumeEmailVerification } = require("./emailVerificationConfirm");

const resolvePhoto = (body) => {
  const incoming = body.profilePhoto ?? body.profileImage ?? body.photo ?? "";
  const normalized = normalizeProfilePhoto(incoming);
  if (!normalized.ok) {
    throw badRequest(normalized.message, ERROR_CODES.INVALID_PHOTO);
  }
  return normalized.profilePhoto || "";
};

const notifyAdminsOfRegistration = async (user) => {
  try {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    if (admins.length === 0) return;

    await Notification.insertMany(
      admins.map((admin) => ({
        recipient: admin._id,
        type: "resident_verification",
        title: "New Resident Registration",
        body: `A new Resident registration for ${user.fullname} is waiting for verification.`,
        tone: "info",
      }))
    );
  } catch (notifErr) {
    logger.warn("Failed to notify admins of new resident registration", {
      error: notifErr.message,
    });
  }
};

const submitResidentRegistration = async (body) => {
  const profile = resolveRegistrationProfile(body ?? {});
  const profilePhoto = resolvePhoto(body);

  const existingUser = await User.findOne({ email: profile.email }).lean();
  if (existingUser) {
    throw conflict("An account with this email already exists.", ERROR_CODES.EMAIL_EXISTS);
  }

  await consumeEmailVerification({
    email: profile.email,
    verificationToken: body?.emailVerificationToken,
  });

  const governmentId = await prepareGovernmentId(body);

  await PendingRegistration.deleteMany({ email: profile.email });

  const user = await User.create({
    ...profile,
    role: "resident",
    verified: false,
    status: "pending",
    profilePhoto,
  });

  const verification = await ResidentVerification.create({
    user: user._id,
    ...governmentId,
    verificationStatus: "pending",
  });

  await notifyAdminsOfRegistration(user);

  return { user, verification, idTypeName: governmentId.idTypeName };
};

module.exports = { submitResidentRegistration };
