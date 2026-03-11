"use strict";
const { transporter, hasCredentials } = require("../config");
const { generatePasswordResetHTML } = require("../templates/passwordReset");
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

module.exports = {
  sendPasswordResetEmail,
};