"use strict";

const User = require("../../models/User");
const PasswordReset = require("../../models/PasswordReset");
const { generateOTP } = require("../../utils/otpGenerator");
const { sendPasswordResetCodeEmail } = require("../mailer");
const { createSystemLog } = require("../systemLogService");
const { tooManyRequests } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { OTP_TTL_MINUTES, RESEND_COOLDOWN_SECONDS } = require("./resetPolicy");

const assertCooldownElapsed = (existing) => {
  if (!existing?.lastSentAt) return;

  const elapsed = (Date.now() - existing.lastSentAt.getTime()) / 1000;
  if (elapsed >= RESEND_COOLDOWN_SECONDS) return;

  throw tooManyRequests(
    `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)} seconds before requesting another code.`,
    ERROR_CODES.OTP_COOLDOWN
  );
};

const issueResetCode = async (email, req) => {
  const user = await User.findOne({ email })
    .select("_id fullname email role verified status")
    .lean();
  if (!user) return;

  assertCooldownElapsed(await PasswordReset.findOne({ email }));

  const otp = generateOTP();

  await PasswordReset.findOneAndDelete({ email });
  await PasswordReset.create({
    email,
    user: user._id,
    otp,
    otpExpires: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
    lastSentAt: new Date(),
  });

  await sendPasswordResetCodeEmail(user.email, otp, user.fullname);

  void createSystemLog({
    req,
    action: "PASSWORD_RESET_REQUESTED",
    user: { _id: user._id, role: user.role },
    role: user.role,
    description: "A password reset code was requested",
    resource: "Auth",
    resourceId: String(user._id),
    metadata: { email: user.email },
  });
};

module.exports = { issueResetCode };
