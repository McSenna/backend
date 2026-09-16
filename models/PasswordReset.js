"use strict";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const PasswordResetSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    otp: { type: String, required: true, select: false },

    otpExpires: { type: Date, required: true },

    lastSentAt: { type: Date, default: Date.now },

    attempts: { type: Number, default: 0 },

    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PasswordResetSchema.index({ otpExpires: 1 }, { expireAfterSeconds: 0 });

PasswordResetSchema.pre("save", async function hashOtp() {
  if (!this.isModified("otp") || !this.otp) return;
  if (BCRYPT_HASH_PATTERN.test(this.otp)) return;
  this.otp = await bcrypt.hash(String(this.otp), 10);
});

PasswordResetSchema.methods.matchesOtp = function matchesOtp(plain) {
  if (!this.otp) return Promise.resolve(false);
  return bcrypt.compare(String(plain).trim(), this.otp);
};

PasswordResetSchema.methods.isExpired = function isExpired() {
  return !this.otpExpires || this.otpExpires.getTime() < Date.now();
};

module.exports = mongoose.model("PasswordReset", PasswordResetSchema, "password_resets");
