const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const PendingRegistrationSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: [2, "Full name must be at least 2 characters"],
      maxlength: [100, "Full name must not exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
      index: true,
    },

    // Stored as base64 data URI (no filesystem paths).
    profilePhoto: {
      type: String,
      required: false,
      default: "",
      trim: true,
    },

    // Backward-compat field (older code used `photo`).
    photo: {
      type: String,
      required: false,
      default: "",
      trim: true,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    gender: {
      type: String,
      enum: {
        values: ["male", "female", "other"],
        message: 'Gender must be "male", "female", or "other"',
      },
      required: [true, "Gender is required"],
    },

    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
    },

    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
      maxlength: [255, "Address must not exceed 255 characters"],
    },

    role: {
      type: String,
      enum: {
        values: ["admin", "doctor", "bhw", "resident"],
        message: "Role must be admin, doctor, bhw, or resident",
      },
      default: "resident",
    },

    otp: {
      type: String,
      required: false,
      select: false,
    },

    otpExpires: {
      type: Date,
      required: false,
      select: false,
    },

    lastOtpSentAt: {
      type: Date,
      default: Date.now,
      select: false,
    },

    verificationAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

PendingRegistrationSchema.index({ otpExpires: 1 }, { expireAfterSeconds: 0 });


PendingRegistrationSchema.pre("validate", function () {
  if (this.gender) {
    this.gender = this.gender.toLowerCase().trim();
  }
});

PendingRegistrationSchema.pre("save", async function () {
  if (this.isModified("password")) {
    if (
      typeof this.password === "string" &&
      !BCRYPT_HASH_PATTERN.test(this.password)
    ) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }
  }

  if (this.isModified("otp") && this.otp) {
    if (
      typeof this.otp === "string" &&
      !BCRYPT_HASH_PATTERN.test(this.otp)
    ) {
      const salt = await bcrypt.genSalt(10);
      this.otp = await bcrypt.hash(this.otp, salt);
    }
  }
});


PendingRegistrationSchema.methods.toJSON = function () {
  const doc = this.toObject();
  delete doc.password;
  delete doc.otp;
  delete doc.otpExpires;
  delete doc.lastOtpSentAt;
  delete doc.verificationAttempts;
  return doc;
};


PendingRegistrationSchema.methods.verifyOtp = async function (plainOtp) {
  if (!this.otp || !this.otpExpires) return false;
  if (this.otpExpires.getTime() < Date.now()) return false;

  if (BCRYPT_HASH_PATTERN.test(this.otp)) {
    return bcrypt.compare(String(plainOtp).trim(), this.otp);
  }
  return this.otp === String(plainOtp).trim();
};

PendingRegistrationSchema.methods.clearOtp = function () {
  this.otp = undefined;
  this.otpExpires = undefined;
  this.verificationAttempts = 0;
};

module.exports = mongoose.model(
  "PendingRegistration",
  PendingRegistrationSchema,
  "pending_registrations"
);