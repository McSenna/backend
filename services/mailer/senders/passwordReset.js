"use strict";
const logger = require("../../../utils/logger");
const { sendMail, hasCredentials, isEmailEnabled, maskEmail } = require("../mailService");

const maskEmailAddress = (email) => {
  const [local = "", domain = ""] = String(email).split("@");
  if (!domain) return "your registered email";
  return `${local.slice(0, 2)}***@${domain}`;
};

const formatChangedAt = (changedAt) => {
  const date = changedAt instanceof Date ? changedAt : new Date(changedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const sendPasswordResetEmail = async (email, fullname = "User", resetUrl = "#") => {
  if (!hasCredentials()) {
    logger.warn("Email settings missing; password reset email not sent", { to: maskEmail(email) });
    return;
  }
  try {
    await sendMail({
      to: email,
      subject: "MaslogCare – Password Reset Request",
      text: [
        `Hello ${fullname},`,
        "",
        "We received a request to reset your MaslogCare password. Open this link within 15 minutes to set a new one:",
        "",
        resetUrl,
        "",
        "If you did not request this, your password stays unchanged. You can ignore this email or report it to help@maslogcare.ph.",
      ].join("\n"),
    });
  } catch (err) {
    throw new Error(`Failed to send password reset email: ${err.message}`);
  }
};

const sendPasswordResetCodeEmail = async (email, otp, fullname = "User") => {
  const masked = maskEmail(email);

  if (!isEmailEnabled() || process.env.EMAIL_PROVIDER === "mock") {
    if (process.env.NODE_ENV !== "production") {
      logger.info(`[RESET][DEV ONLY] Reset code for ${masked}: [${otp}]`);
    }
    return null;
  }

  return sendMail({
    to: email,
    subject: "MaslogCare – Password Reset Code",
    text: [
      `Hello ${fullname},`,
      "",
      `Your MaslogCare password reset code is: ${otp}`,
      "",
      "This code expires in 10 minutes. Do not share it with anyone.",
      "",
      "MaslogCare staff will never ask for this code by phone, SMS, or chat. If someone asks for it, refuse and report it to help@maslogcare.ph.",
      "",
      "If you did not request a password reset, you can ignore this message.",
    ].join("\n"),
  });
};

const sendPasswordChangedEmail = async ({ email, fullname = "User", changedAt = new Date() }) => {
  const masked = maskEmail(email);

  if (!isEmailEnabled() || process.env.EMAIL_PROVIDER === "mock") {
    if (process.env.NODE_ENV !== "production") {
      logger.info(`[SECURITY][DEV ONLY] Password-changed notice for ${masked}`);
    }
    return null;
  }

  return sendMail({
    to: email,
    subject: "Your MaslogCare Password Has Been Changed",
    text: [
      `Hello ${String(fullname).split(" ")[0]},`,
      "",
      "Your MaslogCare account password was successfully changed.",
      "",
      `Account: ${maskEmailAddress(email)}`,
      `Date and time: ${formatChangedAt(changedAt)}`,
      "",
      "If you made this change, no further action is required. You can sign in with your new password.",
      "If you did not, contact the MaslogCare administrator or your Barangay Maslog health office immediately so your account can be secured.",
      "",
      "MaslogCare will never ask you to send your password or verification code by email. Never share them with anyone.",
    ].join("\n"),
  });
};

module.exports = {
  sendPasswordResetEmail,
  sendPasswordResetCodeEmail,
  sendPasswordChangedEmail,
  maskEmailAddress,
};
