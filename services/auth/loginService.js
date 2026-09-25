"use strict";

const User = require("../../models/User");
const { resolveUserStatus } = require("../../models/User");
const logger = require("../../utils/logger");
const { createSystemLog } = require("../systemLogService");
const { clearLoginAttempts } = require("../../middleware/rateLimiter");
const { issueSession } = require("../sessionService");
const { getPlatformDenial } = require("../platformService");
const { describePlatformAccess } = require("../../config/platformAccess");
const { badRequest, unauthorized, forbidden } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { assertAccountMaySignIn, logLoginFailure } = require("./loginGuards");

const invalidCredentials = () =>
  unauthorized("Invalid email or password.", ERROR_CODES.INVALID_CREDENTIALS);

const findLoginCandidate = async ({ req, normalizedEmail, platform }) => {
  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (user) return user;

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
  throw invalidCredentials();
};

const assertPlatformAllowed = async ({ req, user, platform }) => {
  const denial = getPlatformDenial(user.role, platform);
  if (!denial) return;

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
};

const recordLastLogin = async (user) => {
  const loginAt = new Date();
  try {
    await User.updateOne({ _id: user._id }, { $set: { lastLogin: loginAt } });
    user.lastLogin = loginAt;
  } catch (error) {
    logger.warn("Could not record lastLogin timestamp", {
      route: "auth.login",
      errorName: error?.name,
      errorMessage: error?.message,
    });
  }
};

const authenticate = async ({ req, email, password, platform }) => {
  if (!email || !password) {
    throw badRequest("Email and password are required.", ERROR_CODES.MISSING_FIELDS);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await findLoginCandidate({ req, normalizedEmail, platform });

  // The password is checked before any account-state guard so a wrong password
  // always gets the generic error; otherwise the pending/suspended/rejected
  // messages would confirm the email exists without knowing the password.
  if (!(await user.comparePassword(password))) {
    await logLoginFailure({
      req,
      user,
      platform,
      description: "Login attempt failed because the password was invalid",
      reason: "invalid_password",
    });
    throw invalidCredentials();
  }

  await assertAccountMaySignIn({
    req,
    user,
    platform,
    accountStatus: resolveUserStatus(user),
  });

  await assertPlatformAllowed({ req, user, platform });

  const { token, sessionId } = issueSession(user, platform);

  await recordLastLogin(user);
  clearLoginAttempts(user.email);

  await createSystemLog({
    req,
    action: "LOGIN",
    user,
    role: user.role,
    description: `User logged in successfully from the ${platform} platform`,
    resource: "Auth",
    resourceId: String(user._id),
    clientPlatform: platform,
    metadata: { email: user.email, platform, sessionId },
  });

  return { user, token };
};

module.exports = { authenticate };
