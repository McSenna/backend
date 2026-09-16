"use strict";

const { sendOTPEmail } = require("../mailer");
const logger = require("../../utils/logger");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60;
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5;

const deliverOtpEmail = async (email, otp, fullname) => {
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
};

module.exports = {
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_MAX_VERIFY_ATTEMPTS,
  deliverOtpEmail,
};
