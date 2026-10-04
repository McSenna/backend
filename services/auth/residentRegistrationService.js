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
const { createResidentAccount } = require("./registrationDecision");
const { runMasterListCheck } = require("../masterList/masterListMatcher");

const resolvePhoto = (body) => {
  const incoming = body.profilePhoto ?? body.profileImage ?? body.photo ?? "";
  const normalized = normalizeProfilePhoto(incoming);
  if (!normalized.ok) {
    throw badRequest(normalized.message, ERROR_CODES.INVALID_PHOTO);
  }
  return normalized.profilePhoto || "";
};

// Notifications are best effort: a failure is logged and never undoes a sign-up.
const notify = async (buildNotifications, failureMessage) => {
  try {
    const notifications = await buildNotifications();
    if (notifications.length > 0) await Notification.insertMany(notifications);
  } catch (notifErr) {
    logger.warn(failureMessage, { error: notifErr.message });
  }
};

const notifyAdminsOfRegistration = (user, verified) =>
  notify(async () => {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    return admins.map((admin) => ({
      recipient: admin._id,
      type: "resident_verification",
      title: verified ? "Resident Verified Automatically" : "New Resident Registration",
      body: verified
        ? `${user.fullname} registered and was verified against the Barangay Master List.`
        : `A new Resident registration for ${user.fullname} is waiting for verification.`,
      tone: "info",
    }));
  }, "Failed to notify admins of new resident registration");

const notifyResidentVerified = (user) =>
  notify(
    () => [
      {
        recipient: user._id,
        type: "resident_approved",
        title: "Account Approved",
        body: "Your MaslogCare registration has been approved. You may now log in to your account.",
        tone: "success",
      },
    ],
    "Failed to notify resident of automatic verification"
  );

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
  const initialCheck = await runMasterListCheck({
    profile,
    dateOfBirthInput: body?.dateOfBirth || body?.birthdate,
  });

  await PendingRegistration.deleteMany({ email: profile.email });

  const { user, decision, masterListCheck } = await createResidentAccount({
    accountFields: { ...profile, role: "resident", profilePhoto },
    masterListCheck: initialCheck,
  });

  const verification = await ResidentVerification.create({
    user: user._id,
    ...governmentId,
    ...decision.verificationFields,
    masterListCheck,
  });

  await notifyAdminsOfRegistration(user, decision.verified);
  if (decision.verified) await notifyResidentVerified(user);

  return {
    user,
    verification,
    idTypeName: governmentId.idTypeName,
    verified: decision.verified,
    masterListOutcome: masterListCheck.outcome,
  };
};

module.exports = { submitResidentRegistration };
