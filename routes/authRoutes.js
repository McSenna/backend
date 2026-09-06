const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const { otpRateLimiter } = require("../middleware/rateLimiter");
const {
  register,
  sendOtp,
  verifyOtp,
  login,
  logout,
} = require("../controllers/authController");

// Registration and OTP verification (Rate limited)
router.post("/register", otpRateLimiter, register);
router.post("/send-otp", otpRateLimiter, sendOtp);
router.post("/resend-otp", otpRateLimiter, sendOtp); // Standard alias
router.post("/verify-otp", otpRateLimiter, verifyOtp);

// Standard Authentication
router.post("/login", login);
router.post("/logout", auth, logout);

module.exports = router;