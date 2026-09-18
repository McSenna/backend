const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const { otpRateLimiter, loginRateLimiter } = require("../middleware/rateLimiter");
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

router.post("/register", otpRateLimiter, register);
router.post("/send-otp", otpRateLimiter, sendOtp);
router.post("/resend-otp", otpRateLimiter, sendOtp); 
router.post("/verify-otp", otpRateLimiter, verifyOtp);

router.post("/email-verification/send", otpRateLimiter, sendEmailVerificationCode);
router.post("/email-verification/resend", otpRateLimiter, sendEmailVerificationCode);
router.post("/email-verification/verify", otpRateLimiter, verifyEmailVerificationCode);

router.post("/login", loginRateLimiter, login);

router.post("/forgot-password", otpRateLimiter, forgotPassword);
router.post("/resend-reset-code", otpRateLimiter, forgotPassword);
router.post("/verify-reset-code", otpRateLimiter, verifyResetCode);
router.post("/reset-password", otpRateLimiter, resetPassword);
router.post("/logout", auth, logout);
router.post("/change-password", auth, otpRateLimiter, changePassword);

module.exports = router;