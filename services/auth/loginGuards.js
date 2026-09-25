"use strict";

const { createSystemLog } = require("../systemLogService");
const { forbidden } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");

const RESIDENT_DENIALS = {
  pending: {
    description: "Login attempt blocked: Resident account is pending verification",
    reason: "account_pending_verification",
    message:
      "Account Pending Verification\n\nYour registration is currently being reviewed by the Barangay Administrator. You will be able to access your account once your registration has been approved.",
    code: ERROR_CODES.ACCOUNT_PENDING_VERIFICATION,
  },
  rejected: {
    description: "Login attempt blocked: Resident registration was rejected",
    reason: "registration_rejected",
    message:
      "Registration Rejected\n\nYour registration could not be approved. Please contact the Barangay Health Center or Barangay Administrator for assistance.",
    code: ERROR_CODES.REGISTRATION_REJECTED,
  },
  suspended: {
    description: "Login attempt blocked: Resident account is suspended",
    reason: "account_suspended",
    message:
      "Account Suspended\n\nThis account has been suspended. Please contact your administrator.",
    code: ERROR_CODES.ACCOUNT_SUSPENDED,
  },
  deactivated: {
    description: "Login attempt blocked: Resident account is deactivated",
    reason: "account_deactivated",
    message:
      "Account Deactivated\n\nThis account has been deactivated. Please contact your administrator.",
    code: ERROR_CODES.ACCOUNT_DEACTIVATED,
  },
};

RESIDENT_DENIALS.inactive = RESIDENT_DENIALS.deactivated;

const logLoginFailure = ({ req, user, platform, description, reason }) =>
  createSystemLog({
    req,
    action: "LOGIN_FAILED",
    user,
    role: user.role,
    description,
    resource: "Auth",
    success: false,
    clientPlatform: platform,
    metadata: { reason, platform },
  });

const assertResidentMaySignIn = async ({ req, user, platform, accountStatus }) => {
  const denial = RESIDENT_DENIALS[accountStatus];

  if (denial) {
    await logLoginFailure({
      req,
      user,
      platform,
      description: denial.description,
      reason: denial.reason,
    });
    throw forbidden(denial.message, denial.code);
  }

  if (!SIGN_IN_READY_STATUSES.includes(accountStatus)) {
    throw forbidden(
      "Your account is not approved to access MaslogCare.",
      ERROR_CODES.FORBIDDEN
    );
  }
};

const assertStaffMaySignIn = async ({ req, user, platform, accountStatus }) => {
  if (accountStatus === "suspended") {
    throw forbidden("Account Suspended", ERROR_CODES.ACCOUNT_SUSPENDED);
  }
  if (accountStatus === "deactivated" || accountStatus === "inactive") {
    throw forbidden("Account Deactivated", ERROR_CODES.ACCOUNT_DEACTIVATED);
  }
  if (accountStatus === "pending" || accountStatus === "rejected") {
    throw forbidden("Account Pending Verification", ERROR_CODES.ACCOUNT_PENDING_VERIFICATION);
  }
  if (!user.verified && !SIGN_IN_READY_STATUSES.includes(accountStatus)) {
    await logLoginFailure({
      req,
      user,
      platform,
      description: "Login attempt failed because the account is unverified",
      reason: "email_unverified",
    });
    throw forbidden(
      "Please verify your email before logging in.",
      ERROR_CODES.ACCOUNT_UNVERIFIED
    );
  }
};

const assertAccountMaySignIn = (context) =>
  context.user.role === "resident"
    ? assertResidentMaySignIn(context)
    : assertStaffMaySignIn(context);

module.exports = { assertAccountMaySignIn, logLoginFailure };
