const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const {
  otpSendRateLimiter,
  otpVerifyRateLimiter,
  loginRateLimiter,
} = require("../middleware/rateLimiter");
const {
  register,
  sendOtp,
  verifyOtp,
  login,
  logout,
  changePassword,
} = require("../controllers/authController");
const {
  sendEmailVerificationCode,
  verifyEmailVerificationCode,
} = require("../controllers/auth/emailVerificationController");
const {
  forgotPassword,
  verifyResetCode,
  resetPassword,
} = require("../controllers/passwordResetController");

router.post("/register", otpSendRateLimiter, register);
router.post("/send-otp", otpSendRateLimiter, sendOtp);
router.post("/resend-otp", otpSendRateLimiter, sendOtp); 
router.post("/verify-otp", otpVerifyRateLimiter, verifyOtp);

router.post("/email-verification/send", otpSendRateLimiter, sendEmailVerificationCode);
router.post("/email-verification/resend", otpSendRateLimiter, sendEmailVerificationCode);
router.post("/email-verification/verify", otpVerifyRateLimiter, verifyEmailVerificationCode);

router.post("/login", loginRateLimiter, login);

router.post("/forgot-password", otpSendRateLimiter, forgotPassword);
router.post("/resend-reset-code", otpSendRateLimiter, forgotPassword);
router.post("/verify-reset-code", otpVerifyRateLimiter, verifyResetCode);
router.post("/reset-password", otpVerifyRateLimiter, resetPassword);
router.post("/logout", auth, logout);
router.post("/change-password", auth, otpVerifyRateLimiter, changePassword);

module.exports = router;