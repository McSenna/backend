const jwt = require("jsonwebtoken");
const User = require("../models/User");
const PendingRegistration = require("../models/register");
const { sendOTPEmail, sendWelcomeEmail, EmailServiceError } = require("../services/mailer");
const { generateOTP } = require("../utils/otpGenerator");
const { validateRegistrationPayload, isValidOTP } = require("../utils/validation");
const { normalizeProfilePhoto } = require("../utils/profilePhoto");
const { createSystemLog } = require("../services/systemLogService");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES) || 5;
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60;
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS) || 5;

const buildTokenPayload = (user) => ({
  userId: user._id,
  email: user.email,
  role: user.role,
});

const buildUserResponse = (user) => ({
  _id: user._id,
  fullname: user.fullname,
  email: user.email,
  role: user.role,
  verified: user.verified,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  address: user.address,
  avatarUrl: user.profilePhoto || null,
});

exports.register = async (req, res, next) => {
  try {
    const { fullname, email, password, gender, dateOfBirth, birthdate, address } = req.body;
    const dob = dateOfBirth || birthdate;

    const validation = validateRegistrationPayload({ fullname, email, password, gender, dateOfBirth: dob, address });
    if (!validation.isValid) {
      return res.status(400).json({ success: false, code: "VALIDATION_FAILED", message: "Validation failed", errors: validation.errors });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const incomingPhoto = req.body.profilePhoto ?? req.body.profileImage ?? req.body.photo ?? "";
    const normalizedPhoto = normalizeProfilePhoto(incomingPhoto);
    if (!normalizedPhoto.ok) {
      return res.status(400).json({ success: false, code: "INVALID_PHOTO", message: normalizedPhoto.message });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ success: false, code: "EMAIL_EXISTS", message: "Email already registered" });
    }

    await PendingRegistration.deleteMany({ email: normalizedEmail });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await PendingRegistration.create({
      fullname: fullname.trim(),
      email: normalizedEmail,
      password,
      gender: gender.toLowerCase(),
      dateOfBirth: new Date(dob),
      address: address.trim(),
      role: "resident",
      otp,
      otpExpires,
      lastOtpSentAt: new Date(),
      verificationAttempts: 0,
      profilePhoto: normalizedPhoto.profilePhoto,
    });

    try {
      await sendOTPEmail(normalizedEmail, otp, fullname.trim());
    } catch (emailError) {
      console.error(`❌ [AUTH] OTP email delivery failed for ${normalizedEmail}:`, emailError.message);

      if (emailError instanceof EmailServiceError) {
        return res.status(emailError.httpStatus).json({
          success: false,
          code: emailError.code === "EMAIL_QUOTA_EXCEEDED" ? "EMAIL_SERVICE_LIMIT" : emailError.code,
          message: emailError.userMessage,
          email: normalizedEmail,
        });
      }

      return res.status(503).json({
        success: false,
        code: "EMAIL_SERVICE_LIMIT",
        message: "The verification email service is temporarily unavailable. Please try again later.",
        email: normalizedEmail,
      });
    }

    return res.status(200).json({
      success: true,
      message: `OTP sent to your email. Please verify within ${OTP_EXPIRY_MINUTES} minutes.`,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("❌ Error in register:", error);
    next(error);
  }
};

exports.sendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, code: "EMAIL_REQUIRED", message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user is already verified and registered
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser && existingUser.verified) {
      return res.status(400).json({
        success: false,
        code: "ALREADY_VERIFIED",
        message: "This account is already registered and verified. Please log in.",
      });
    }

    const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select("+otp +otpExpires +lastOtpSentAt +verificationAttempts");

    if (!pending) {
      return res.status(404).json({
        success: false,
        code: "REGISTRATION_NOT_FOUND",
        message: "No pending registration found. Please register first.",
      });
    }

    // Enforce resend cooldown
    const now = Date.now();
    const lastSent = pending.lastOtpSentAt ? new Date(pending.lastOtpSentAt).getTime() : 0;
    const elapsedSeconds = Math.floor((now - lastSent) / 1000);

    if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      return res.status(429).json({
        success: false,
        code: "OTP_COOLDOWN",
        message: `Please wait ${waitSeconds} second${waitSeconds === 1 ? "" : "s"} before requesting another verification code.`,
        retryAfter: waitSeconds,
      });
    }

    const newOtp = generateOTP();
    pending.otp = newOtp;
    pending.otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    pending.lastOtpSentAt = new Date();
    pending.verificationAttempts = 0;
    await pending.save();

    try {
      await sendOTPEmail(normalizedEmail, newOtp, pending.fullname);
    } catch (emailError) {
      console.error(`❌ [AUTH] Resend OTP email failed for ${normalizedEmail}:`, emailError.message);

      if (emailError instanceof EmailServiceError) {
        return res.status(emailError.httpStatus).json({
          success: false,
          code: emailError.code === "EMAIL_QUOTA_EXCEEDED" ? "EMAIL_SERVICE_LIMIT" : emailError.code,
          message: emailError.userMessage,
        });
      }

      return res.status(503).json({
        success: false,
        code: "EMAIL_SERVICE_LIMIT",
        message: "The verification email service is temporarily unavailable. Please try again later.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    console.error("❌ Error in sendOtp:", error);
    next(error);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, code: "MISSING_FIELDS", message: "Email and verification code are required" });
    }

    if (!isValidOTP(otp)) {
      return res.status(400).json({ success: false, code: "INVALID_FORMAT", message: "Verification code must be 6 digits" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select("+password +otp +otpExpires +verificationAttempts");

    if (!pending) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SESSION",
        message: "No pending verification found. Your session may have expired. Please register again.",
      });
    }

    if (new Date() > new Date(pending.otpExpires)) {
      return res.status(400).json({
        success: false,
        code: "OTP_EXPIRED",
        message: "Verification code has expired. Please request a new code.",
      });
    }

    const currentAttempts = pending.verificationAttempts || 0;
    if (currentAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        code: "OTP_MAX_ATTEMPTS",
        message: "Maximum verification attempts exceeded. Please register again.",
      });
    }

    const isOtpValid = await pending.verifyOtp(otp);
    if (!isOtpValid) {
      pending.verificationAttempts = currentAttempts + 1;
      await pending.save();

      const remainingAttempts = OTP_MAX_VERIFY_ATTEMPTS - pending.verificationAttempts;
      if (remainingAttempts <= 0) {
        await PendingRegistration.deleteOne({ _id: pending._id });
        return res.status(400).json({
          success: false,
          code: "OTP_MAX_ATTEMPTS",
          message: "Maximum verification attempts exceeded. Please register again.",
        });
      }

      return res.status(400).json({
        success: false,
        code: "OTP_INVALID",
        message: `Incorrect verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`,
        remainingAttempts,
      });
    }

    // OTP is valid: create user account
    const user = await User.create({
      fullname: pending.fullname,
      email: pending.email,
      password: pending.password,
      gender: pending.gender,
      dateOfBirth: pending.dateOfBirth,
      address: pending.address,
      verified: true,
      role: "resident",
      profilePhoto: pending.profilePhoto || "",
    });

    // Clean up pending registration
    await PendingRegistration.deleteOne({ _id: pending._id });

    // Send welcome email asynchronously without blocking or failing registration
    sendWelcomeEmail(user.email, user.fullname).catch((emailError) => {
      console.warn(`⚠️  [AUTH] Welcome email delivery failed for ${user.email}:`, emailError.message);
    });

    const token = jwt.sign(buildTokenPayload(user), process.env.JWT_SECRET, { expiresIn: "7d" });

    await createSystemLog({
      req,
      action: "USER_CREATED",
      user,
      role: user.role,
      description: "Resident account was created and verified",
      resource: "User",
      resourceId: String(user._id),
      metadata: {
        email: user.email,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Registration completed successfully",
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("❌ Error in verifyOtp:", error);
    next(error);
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      await createSystemLog({
        req,
        action: "LOGIN_FAILED",
        role: "unknown",
        description: "Login attempt failed because the email does not exist",
        resource: "Auth",
        metadata: {
          attemptedEmail: normalizedEmail,
          reason: "user_not_found",
        },
      });
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (!user.verified) {
      await createSystemLog({
        req,
        action: "LOGIN_FAILED",
        user,
        role: user.role,
        description: "Login attempt failed because the account is unverified",
        resource: "Auth",
        metadata: {
          reason: "email_unverified",
        },
      });
      return res.status(403).json({ success: false, message: "Please verify your email before logging in" });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await createSystemLog({
        req,
        action: "LOGIN_FAILED",
        user,
        role: user.role,
        description: "Login attempt failed because the password was invalid",
        resource: "Auth",
        metadata: {
          reason: "invalid_password",
        },
      });
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(buildTokenPayload(user), process.env.JWT_SECRET, { expiresIn: "7d" });

    await createSystemLog({
      req,
      action: "LOGIN",
      user,
      role: user.role,
      description: "User logged in successfully",
      resource: "Auth",
      resourceId: String(user._id),
      metadata: {
        email: user.email,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("❌ Error in login:", error);
    return res.status(500).json({ success: false, message: "Server error during login. Please try again later." });
  }
};

exports.logout = async (req, res) => {
  try {
    const actor = req.user || {};
    await createSystemLog({
      req,
      action: "LOGOUT",
      user: actor,
      role: actor.role,
      description: "User logged out of the application",
      resource: "Auth",
      success: true,
    });

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("❌ Error in logout:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during logout. Please try again later.",
    });
  }
};