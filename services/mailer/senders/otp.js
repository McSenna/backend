"use strict";

const logger = require("../../../utils/logger");
const { sendMail, maskEmail, isEmailEnabled } = require("../mailService");

const sendOTPEmail = async (email, otp, fullname = "User") => {
  const masked = maskEmail(email);
  const isProd = process.env.NODE_ENV === "production";

  if (!isEmailEnabled() || process.env.EMAIL_PROVIDER === "mock") {
    if (!isProd) {
      logger.info(`[DEV ONLY] Simulation OTP for ${masked}: [${otp}]`);
    }
  }

  return sendMail({
    to: email,
    subject: "MaslogCare – Your Verification Code",
    text: [
      `Hello ${fullname},`,
      "",
      `Your MaslogCare verification code is: ${otp}`,
      "",
      "This code expires in 5 minutes. Do not share it with anyone.",
      "",
      "MaslogCare staff will never ask for this code by phone, SMS, or chat. If someone asks for it, refuse and report it to help@maslogcare.ph.",
      "",
      "If you did not request this, you can ignore this message.",
    ].join("\n"),
  });
};

module.exports = {
  sendOTPEmail,
};
