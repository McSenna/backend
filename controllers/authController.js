const jwt = require("jsonwebtoken");
const User = require("../models/User");
const PendingRegistration = require("../models/register");
const { sendOTPEmail, sendWelcomeEmail } = require("../services/mailer");
const { generateOTP } = require("../utils/otpGenerator");
const { validateRegistrationPayload, isValidOTP } = require("../utils/validation");
const { normalizeProfilePhoto } = require("../utils/profilePhoto");

const OTP_EXPIRY_MINUTES = 5;

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
  // Base64 data URI used directly by the frontend Image component.
  avatarUrl: user.profilePhoto || null,
});

exports.register = async (req, res) => {
  try {
    const { fullname, email, password, gender, dateOfBirth, birthdate, address } = req.body;
    const dob = dateOfBirth || birthdate;

    const validation = validateRegistrationPayload({ fullname, email, password, gender, dateOfBirth: dob, address });
    if (!validation.isValid) {
      return res.status(400).json({ success: false, message: "Validation failed", errors: validation.errors });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const incomingPhoto = req.body.profilePhoto ?? req.body.profileImage ?? req.body.photo ?? "";
    const normalizedPhoto = normalizeProfilePhoto(incomingPhoto);
    if (!normalizedPhoto.ok) {
      return res.status(400).json({ success: false, message: normalizedPhoto.message });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "Email already registered" });
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
      profilePhoto: normalizedPhoto.profilePhoto,
    });

    try {
      await sendOTPEmail(normalizedEmail, otp, fullname.trim());
    } catch (emailError) {
      console.error("Email sending error:", emailError);
    }

    return res.status(200).json({
      success: true,
      message: "OTP sent to your email. Please verify within 5 minutes.",
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("❌ Error in register:", error);
    return res.status(500).json({ success: false, message: "Server error during registration. Please try again later." });
  }
};

exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select("+otp +otpExpires");

    if (!pending) {
      return res.status(404).json({ success: false, message: "No pending registration found. Please register first." });
    }

    pending.otp = generateOTP();
    pending.otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await pending.save();

    try {
      await sendOTPEmail(normalizedEmail, pending.otp, pending.fullname);
    } catch (emailError) {
      console.error("Email sending error:", emailError);
    }

    return res.status(200).json({ success: true, message: "A new verification code has been sent to your email." });
  } catch (error) {
    console.error("❌ Error in sendOtp:", error);
    return res.status(500).json({ success: false, message: "Server error while resending verification code." });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and verification code are required" });
    }

    if (!isValidOTP(otp)) {
      return res.status(400).json({ success: false, message: "Invalid verification code format" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pending = await PendingRegistration.findOne({ email: normalizedEmail }).select("+password +otp +otpExpires");

    if (!pending) {
      return res.status(400).json({ success: false, message: "Invalid or expired verification code" });
    }

    const isOtpValid = await pending.verifyOtp(otp);
    if (!isOtpValid) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ success: false, message: "Invalid or expired verification code" });
    }

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

    await PendingRegistration.deleteOne({ _id: pending._id });

    try {
      await sendWelcomeEmail(user.email, user.fullname);
    } catch (emailError) {
      console.error("Welcome email error:", emailError);
    }

    const token = jwt.sign(buildTokenPayload(user), process.env.JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({
      success: true,
      message: "Registration completed successfully",
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("❌ Error in verifyOtp:", error);
    return res.status(500).json({ success: false, message: "Server error during verification. Please try again later." });
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
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    if (!user.verified) {
      return res.status(403).json({ success: false, message: "Please verify your email before logging in" });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(buildTokenPayload(user), process.env.JWT_SECRET, { expiresIn: "7d" });

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