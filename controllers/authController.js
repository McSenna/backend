"use strict";

const User = require("../models/User");
const { BLOCKED_STATUSES, resolveUserStatus } = require("../models/User");
const PendingRegistration = require("../models/register");
const { sendOTPEmail, sendWelcomeEmail } = require("../services/mailer");
const { generateOTP } = require("../utils/otpGenerator");
const { validateRegistrationPayload, isValidOTP } = require("../utils/validation");
const { normalizeProfilePhoto } = require("../utils/profilePhoto");
const { createSystemLog } = require("../services/systemLogService");
const { issueSession } = require("../services/sessionService");
const {
  resolveRequestPlatform,
  getPlatformDenial,
} = require("../services/platformService");
const { describePlatformAccess } = require("../config/platformAccess");
const asyncHandler = require("../utils/asyncHandler");
const logger = require("../utils/logger");
const {
  badRequest,
  validationFailed,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
} = require("../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../utils/errorCodes");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60;
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5;

const buildUserResponse = (user) => ({
  _id: user._id,
  fullname: user.fullname,
  email: user.email,
  role: user.role,
  verified: user.verified,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  address: user.address,
  phone: user.phone || "",
  avatarUrl: user.profilePhoto || null,
  /**
   * Which clients this account may sign in from. Derived from the role, so it
   * is descriptive for the UI and never the thing the client checks: the
   * server has already refused any platform this list excludes.
   */
  platformAccess: describePlatformAccess(user.role),
});

/** The platform this request is attributed to, resolved server-side. */
const platformOf = (req) => (req.clientPlatform || resolveRequestPlatform(req)).platform;

/**
 * OTP delivery is the one place where a downstream service failure must not be
 * flattened into a generic 500: the caller needs to know the account was saved
 * and only the email failed. `classifySmtpError` has already turned the SMTP
 * fault into an EmailServiceError, which the global handler maps to a safe
 * message and the right status, so it is simply re-thrown.
 */
async function deliverOtpEmail(email, otp, fullname) {
  try {
    await sendOTPEmail(email, otp, fullname);
  } catch (emailError) {
    logger.error("OTP email delivery failed", {
      route: "auth",
      errorName: emailError?.name,
      errorCode: emailError?.code,
    });
    throw emailError;
  }
}

exports.register = asyncHandler(async (req, res) => {
  const { fullname, email, password, gender, dateOfBirth, birthdate, address } = req.body;
  const dob = dateOfBirth || birthdate;

  const validation = validateRegistrationPayload({
    fullname,
    email,
    password,
    gender,
    dateOfBirth: dob,
    address,
  });

  if (!validation.isValid) {
    throw validationFailed(validation.errors[0], validation.errors);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const incomingPhoto = req.body.profilePhoto ?? req.body.profileImage ?? req.body.photo ?? "";
  const normalizedPhoto = normalizeProfilePhoto(incomingPhoto);
  if (!normalizedPhoto.ok) {
    throw badRequest(normalizedPhoto.message, ERROR_CODES.INVALID_PHOTO);
  }

  const existingUser = await User.findOne({ email: normalizedEmail }).lean();
  if (existingUser) {
    throw conflict(
      "This email address is already registered.",
      ERROR_CODES.EMAIL_EXISTS
    );
  }

  await PendingRegistration.deleteMany({ email: normalizedEmail });

  const otp = generateOTP();
  const otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await PendingRegistration.create({
    fullname: fullname.trim(),
    email: normalizedEmail,
    password,
    gender: gender.toLowerCase(),
    dateOfBirth: new Date(dob),
    address: address.trim(),
    role: "resident",
    otp,
    otpExpires,
    lastOtpSentAt: new Date(),
    verificationAttempts: 0,
    profilePhoto: normalizedPhoto.profilePhoto,
  });

  await deliverOtpEmail(normalizedEmail, otp, fullname.trim());

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `OTP sent to your email. Please verify within ${OTP_EXPIRY_MINUTES} minutes.`,
    email: normalizedEmail,
  });
});

exports.sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw badRequest("Email is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await User.findOne({ email: normalizedEmail }).lean();
  if (existingUser && existingUser.verified) {
    throw conflict(
      "This account is already registered and verified. Please log in.",
      ERROR_CODES.ALREADY_VERIFIED
    );
  }

  const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select(
    "+otp +otpExpires +lastOtpSentAt +verificationAttempts"
  );

  if (!pending) {
    throw notFound(
      "No pending registration found. Please register first.",
      ERROR_CODES.REGISTRATION_NOT_FOUND
    );
  }

  // Enforce resend cooldown.
  const lastSent = pending.lastOtpSentAt ? new Date(pending.lastOtpSentAt).getTime() : 0;
  const elapsedSeconds = Math.floor((Date.now() - lastSent) / 1000);

  if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
    const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
    const error = tooManyRequests(
      `Please wait ${waitSeconds} second${waitSeconds === 1 ? "" : "s"} before requesting another verification code.`,
      ERROR_CODES.OTP_COOLDOWN
    );
    error.details = { retryAfter: waitSeconds };
    throw error;
  }

  const newOtp = generateOTP();
  pending.otp = newOtp;
  pending.otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  pending.lastOtpSentAt = new Date();
  pending.verificationAttempts = 0;
  await pending.save();

  await deliverOtpEmail(normalizedEmail, newOtp, pending.fullname);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "A new verification code has been sent to your email.",
  });
});

exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw badRequest(
      "Email and verification code are required.",
      ERROR_CODES.MISSING_FIELDS
    );
  }

  if (!isValidOTP(otp)) {
    throw badRequest(
      "Verification code must be 6 digits.",
      ERROR_CODES.INVALID_FORMAT
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select(
    "+password +otp +otpExpires +verificationAttempts"
  );

  if (!pending) {
    throw badRequest(
      "No pending verification found. Your session may have expired. Please register again.",
      ERROR_CODES.INVALID_SESSION
    );
  }

  if (new Date() > new Date(pending.otpExpires)) {
    throw badRequest(
      "Verification code has expired. Please request a new code.",
      ERROR_CODES.OTP_EXPIRED
    );
  }

  const currentAttempts = pending.verificationAttempts || 0;
  if (currentAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    throw badRequest(
      "Maximum verification attempts exceeded. Please register again.",
      ERROR_CODES.OTP_MAX_ATTEMPTS
    );
  }

  const isOtpValid = await pending.verifyOtp(otp);
  if (!isOtpValid) {
    pending.verificationAttempts = currentAttempts + 1;
    await pending.save();

    const remainingAttempts = OTP_MAX_VERIFY_ATTEMPTS - pending.verificationAttempts;
    if (remainingAttempts <= 0) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      throw badRequest(
        "Maximum verification attempts exceeded. Please register again.",
        ERROR_CODES.OTP_MAX_ATTEMPTS
      );
    }

    const error = badRequest(
      `Incorrect verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`,
      ERROR_CODES.OTP_INVALID
    );
    error.details = { remainingAttempts };
    throw error;
  }

  // OTP is valid: promote the pending registration into a real account.
  const user = await User.create({
    fullname: pending.fullname,
    email: pending.email,
    password: pending.password,
    gender: pending.gender,
    dateOfBirth: pending.dateOfBirth,
    address: pending.address,
    verified: true,
    role: "resident",
    profilePhoto: pending.profilePhoto || "",
  });

  await PendingRegistration.deleteOne({ _id: pending._id });

  // The welcome email is cosmetic: a delivery failure must not fail a
  // registration that already succeeded, so it is logged and swallowed here
  // deliberately rather than by accident.
  void sendWelcomeEmail(user.email, user.fullname).catch((emailError) => {
    logger.warn("Welcome email delivery failed", {
      errorName: emailError?.name,
      errorCode: emailError?.code,
    });
  });

  await createSystemLog({
    req,
    action: "USER_CREATED",
    user,
    role: user.role,
    description: "Resident account was created and verified",
    resource: "User",
    resourceId: String(user._id),
    metadata: { email: user.email },
  });

  // Verifying an email is not, on its own, permission to hold a session on
  // this client. Registration from the web creates the resident's account and
  // stops there: the account is real, the session is not issued, and the web
  // client is told to continue on mobile. Signing them in "just this once"
  // would be exactly the web session the policy forbids.
  const platform = platformOf(req);
  const denial = getPlatformDenial(user.role, platform);

  if (denial) {
    await createSystemLog({
      req,
      action: "RESIDENT_WEB_LOGIN_BLOCKED",
      user,
      role: user.role,
      description:
        "Registration completed but no web session was issued: resident accounts are mobile-only",
      resource: "Auth",
      resourceId: String(user._id),
      success: false,
      clientPlatform: platform,
      metadata: { platform, reason: "platform_not_allowed" },
    });

    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      code: denial.code,
      message: `Registration completed successfully. ${denial.message}`,
      token: null,
      user: buildUserResponse(user),
      platform,
    });
  }

  const { token } = issueSession(user, platform);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Registration completed successfully.",
    token,
    user: buildUserResponse(user),
    platform,
  });
});

/**
 * Signs a user in on one platform.
 *
 * The order of the checks is deliberate. Credentials and account standing are
 * settled first, so the platform decision is only ever revealed to someone who
 * has already proved the account is theirs — the platform error would
 * otherwise tell a stranger that an address belongs to a resident. Only once
 * every earlier gate has passed is the platform matrix consulted, and only if
 * it passes is a session minted: a denied platform never reaches issueSession,
 * so no token, no session id and no authenticated state exist for it at all.
 */
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const platform = platformOf(req);

  if (!email || !password) {
    throw badRequest(
      "Email and password are required.",
      ERROR_CODES.MISSING_FIELDS
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select("+password");

  // A missing account and a wrong password return the same message and code so
  // the endpoint cannot be used to enumerate registered email addresses.
  if (!user) {
    await createSystemLog({
      req,
      action: "LOGIN_FAILED",
      role: "unknown",
      description: "Login attempt failed because the email does not exist",
      resource: "Auth",
      success: false,
      clientPlatform: platform,
      metadata: { attemptedEmail: normalizedEmail, reason: "user_not_found", platform },
    });
    throw unauthorized(
      "Invalid email or password.",
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  if (!user.verified) {
    await createSystemLog({
      req,
      action: "LOGIN_FAILED",
      user,
      role: user.role,
      description: "Login attempt failed because the account is unverified",
      resource: "Auth",
      success: false,
      clientPlatform: platform,
      metadata: { reason: "email_unverified", platform },
    });
    throw forbidden(
      "Please verify your email before logging in.",
      ERROR_CODES.ACCOUNT_UNVERIFIED
    );
  }

  // Account standing is checked after verification and before the password so
  // a barred account cannot be probed for a valid password. `verified` above
  // still governs email confirmation; this governs administrator action.
  const accountStatus = resolveUserStatus(user);
  if (BLOCKED_STATUSES.includes(accountStatus)) {
    await createSystemLog({
      req,
      action: "LOGIN_FAILED",
      user,
      role: user.role,
      description: `Login attempt failed because the account is ${accountStatus}`,
      resource: "Auth",
      success: false,
      clientPlatform: platform,
      metadata: { reason: `account_${accountStatus}`, platform },
    });
    throw forbidden(
      accountStatus === "suspended"
        ? "This account has been suspended. Please contact your administrator."
        : "This account is inactive. Please contact your administrator.",
      ERROR_CODES.ACCOUNT_DISABLED
    );
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    await createSystemLog({
      req,
      action: "LOGIN_FAILED",
      user,
      role: user.role,
      description: "Login attempt failed because the password was invalid",
      resource: "Auth",
      success: false,
      clientPlatform: platform,
      metadata: { reason: "invalid_password", platform },
    });
    throw unauthorized(
      "Invalid email or password.",
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  // Platform authorization. Reached only with valid credentials on a
  // non-blocked account, and evaluated before any session exists.
  const denial = getPlatformDenial(user.role, platform);
  if (denial) {
    await createSystemLog({
      req,
      action:
        denial.code === ERROR_CODES.RESIDENT_WEB_ACCESS_DENIED
          ? "RESIDENT_WEB_LOGIN_BLOCKED"
          : "PLATFORM_ACCESS_DENIED",
      user,
      role: user.role,
      description: `Login blocked: ${user.role} accounts may not sign in from the ${platform} platform`,
      resource: "Auth",
      resourceId: String(user._id),
      success: false,
      clientPlatform: platform,
      metadata: {
        platform,
        reason: "platform_not_allowed",
        policy: describePlatformAccess(user.role).label,
      },
    });

    throw forbidden(denial.message, denial.code);
  }

  const { token, sessionId } = issueSession(user, platform);

  // Recorded after the password check so a failed attempt never counts as a
  // sign-in. A targeted $set keeps the document out of the password-hashing
  // pre-save hook, and a failure here must not cost the user their login.
  const loginAt = new Date();
  try {
    await User.updateOne({ _id: user._id }, { $set: { lastLogin: loginAt } });
    user.lastLogin = loginAt;
  } catch {
    // Non-fatal: the sign-in itself has already succeeded.
  }

  await createSystemLog({
    req,
    action: "LOGIN",
    user,
    role: user.role,
    description: `User logged in successfully from the ${platform} platform`,
    resource: "Auth",
    resourceId: String(user._id),
    clientPlatform: platform,
    // sessionId identifies this sign-in, so a staff member's parallel web and
    // mobile sessions stay distinguishable in the audit trail. The token
    // itself is never logged.
    metadata: { email: user.email, platform, sessionId },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Login successful.",
    token,
    user: buildUserResponse(user),
    platform,
  });
});

exports.logout = asyncHandler(async (req, res) => {
  const actor = req.user || {};

  await createSystemLog({
    req,
    action: "LOGOUT",
    user: actor,
    role: actor.role,
    description: `User logged out of the ${req.auth?.platform || "unknown"} platform`,
    resource: "Auth",
    success: true,
    metadata: { platform: req.auth?.platform, sessionId: req.auth?.sessionId },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Logout successful.",
  });
});
