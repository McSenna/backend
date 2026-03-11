"use strict";
const { transporter, hasCredentials } = require("../config");
const { generateOTPEmailHTML } = require("../templates/otp");
const { buildAttachments } = require("../assets");

const sendOTPEmail = async (email, otp, fullname = "User") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. OTP would be sent to:", email, "code:", otp);
    return;
  }
  try {
    const info = await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Your Verification Code",
      html:        generateOTPEmailHTML(fullname, otp),
      text:        `Your MaslogCare verification code is: ${otp}\n\nExpires in 5 minutes. Do not share this code.\nIf you did not request this, please ignore this message.`,
      attachments: buildAttachments("logo", "heroOtp"),
    });
    console.log("✅ OTP email sent:", info.response);
    return info;
  } catch (err) {
    console.error("❌ Error sending OTP email:", err);
    throw new Error(`Failed to send verification email: ${err.message}`);
  }
};

module.exports = {
  sendOTPEmail,
};