"use strict";
const { transporter, hasCredentials } = require("../config");
const { generatePasswordResetHTML } = require("../templates/passwordResetTemplate");
const { buildAttachments } = require("../assets");

const sendPasswordResetEmail = async (email, fullname = "User", resetUrl = "#") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send password reset to:", email, "url:", resetUrl);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Password Reset Request",
      html:        generatePasswordResetHTML(fullname, resetUrl),
      text:        `Hello ${fullname},\n\nYou requested a password reset for your MaslogCare account.\n\nReset link (valid for 15 minutes):\n${resetUrl}\n\nIf you did not request this, please ignore this email or contact help@maslogcare.ph.`,
      attachments: buildAttachments("logo", "heroOtp"),
    });
    console.log("✅ Password reset email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending password reset email:", err);
    throw new Error(`Failed to send password reset email: ${err.message}`);
  }
};

const { sendMail, isEmailEnabled, maskEmail } = require("../mailService");
const { generateOTPEmailHTML } = require("../templates/otpTemplate");

const sendPasswordResetCodeEmail = async (email, otp, fullname = "User") => {
  const masked = maskEmail(email);

  if (!isEmailEnabled() || process.env.EMAIL_PROVIDER === "mock") {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[RESET][DEV ONLY] Reset code for ${masked}: [${otp}]`);
    }
    return null;
  }

  try {
    const info = await sendMail({
      to: email,
      subject: "MaslogCare – Password Reset Code",
      html: generateOTPEmailHTML(fullname, otp),
      text: `Your MaslogCare password reset code is: ${otp}\n\nExpires in 10 minutes. Do not share this code.\nIf you did not request a password reset, you can ignore this message.`,
      attachments: buildAttachments("logo", "heroOtp"),
    });
    console.log(`[RESET] Reset code accepted for delivery to ${masked}`);
    return info;
  } catch (err) {
    console.error(`[RESET] Delivery rejected for ${masked}: [${err.code || "UNKNOWN"}] ${err.message}`);
    throw err;
  }
};

const { generatePasswordChangedHTML } = require("../templates/passwordChangedTemplate");

const sendPasswordChangedEmail = async ({ email, fullname = "User", changedAt = new Date() }) => {
  const masked = maskEmail(email);

  if (!isEmailEnabled() || process.env.EMAIL_PROVIDER === "mock") {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[SECURITY][DEV ONLY] Password-changed notice for ${masked}`);
    }
    return null;
  }

  const info = await sendMail({
    to: email,
    subject: "Your MaslogCare Password Has Been Changed",
    html: generatePasswordChangedHTML(fullname, email, changedAt),
    text: [
      `Hello ${String(fullname).split(" ")[0]},`,
      "",
      "Your MaslogCare account password was successfully changed.",
      "",
      `Account: ${email}`,
      `Date and time: ${new Date(changedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`,
      "",
      "If you made this change, no further action is required.",
      "If you did not, contact the MaslogCare administrator or your Barangay Maslog health office immediately.",
      "",
      "MaslogCare will never ask you to send your password or verification code by email.",
    ].join("\n"),
    attachments: buildAttachments("logo", "heroNotif"),
  });

  console.log(`[SECURITY] Password-changed notice accepted for delivery to ${masked}`);
  return info;
};

module.exports = {
  sendPasswordResetEmail,
  sendPasswordResetCodeEmail,
  sendPasswordChangedEmail,
};
