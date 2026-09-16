"use strict";

const { forgotPassword } = require("./passwordReset/requestCodeController");
const { verifyResetCode } = require("./passwordReset/verifyCodeController");
const { resetPassword } = require("./passwordReset/resetPasswordController");
const {
  OTP_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  MAX_VERIFY_ATTEMPTS,
} = require("../services/passwordReset/resetPolicy");

module.exports = {
  forgotPassword,
  verifyResetCode,
  resetPassword,
  OTP_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  MAX_VERIFY_ATTEMPTS,
};
