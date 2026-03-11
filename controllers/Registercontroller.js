const { validationResult, body } = require("express-validator");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const PendingRegistration = require("../models/Register");

const registerValidators = [
  body("fullname").trim().notEmpty().withMessage("Full name is required")
    .isLength({ min: 2, max: 100 }).withMessage("Full name must be 2–100 characters"),

  body("email").trim().notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/).withMessage("Password must contain at least one letter and one number"),

  body("gender").trim().notEmpty().withMessage("Gender is required")
    .toLowerCase().isIn(["male", "female", "other"]).withMessage('Gender must be "male", "female", or "other"'),

  body("dateOfBirth").notEmpty().withMessage("Date of birth is required")
    .isISO8601().withMessage("Date of birth must be a valid date (YYYY-MM-DD)").toDate(),

  body("address").trim().notEmpty().withMessage("Address is required")
    .isLength({ max: 255 }).withMessage("Address must not exceed 255 characters"),
];

const generateOtp = () => String(crypto.randomInt(100_000, 999_999));

const sendOtpEmail = async (email, otp) => {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[DEV] OTP for ${email}: ${otp}`);
  }
};

const registerController = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg);
    return res.status(422).json({ success: false, message: messages[0], errors: messages });
  }

  const { fullname, email, password, gender, dateOfBirth, address } = req.body;

  try {
    await PendingRegistration.deleteOne({ email });

    const pending = new PendingRegistration({ fullname, email, password, gender, dateOfBirth, address });

    const plainOtp = generateOtp();
    pending.otp = await bcrypt.hash(plainOtp, 10);
    pending.otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await pending.save();
    await sendOtpEmail(email, plainOtp);

    return res.status(201).json({
      success: true,
      message: "Registration successful. Please check your email for the OTP.",
      email,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(422).json({ success: false, message: messages[0], errors: messages });
    }

    console.error("❌ Registration error:", error);
    return res.status(500).json({ success: false, message: "An unexpected error occurred. Please try again." });
  }
};

module.exports = { registerController, registerValidators };