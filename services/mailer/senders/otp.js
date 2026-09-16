"use strict";

const { sendMail, maskEmail, isEmailEnabled } = require("../mailService");
const { generateOTPEmailHTML } = require("../templates/otpTemplate");
const { buildAttachments } = require("../assets");

const sendOTPEmail = async (email, otp, fullname = "User") => {
  const masked = maskEmail(email);
  const isProd = process.env.NODE_ENV === "production";

  console.log(`[OTP] Request received for ${masked}`);

  if (!isEmailEnabled() || process.env.EMAIL_PROVIDER === "mock") {
    if (!isProd) {
      console.log(`[DEV ONLY] Simulation OTP for ${masked}: [${otp}]`);
    }
  }

  try {
    console.log(`[OTP] Attempting email delivery to ${masked}`);
    const info = await sendMail({
      to: email,
      subject: "MaslogCare – Your Verification Code",
      html: generateOTPEmailHTML(fullname, otp),
      text: `Your MaslogCare verification code is: ${otp}\n\nExpires in 5 minutes. Do not share this code.\nIf you did not request this, please ignore this message.`,
      attachments: buildAttachments("logo", "heroOtp"),
    });

    console.log(`[OTP] Email accepted for delivery to ${masked}`);
    return info;
  } catch (err) {
    console.error(`[OTP] Email rejected for ${masked}: [${err.code || "UNKNOWN"}] ${err.message}`);
    throw err;
  } finally {
    console.log(`[OTP] Request completed for ${masked}`);
  }
};

module.exports = {
  sendOTPEmail,
};
