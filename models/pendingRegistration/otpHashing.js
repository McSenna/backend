"use strict";

const bcrypt = require("bcryptjs");
const { BCRYPT_HASH_PATTERN, isAlreadyHashed } = require("../user/passwordHashing");

const hashIfNeeded = async (value) => {
  if (typeof value !== "string" || isAlreadyHashed(value)) return value;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(value, salt);
};

// Mongoose hooks and instance methods depend on `this`, so they stay function
// expressions rather than arrows.
const attachSecretHashing = (schema) => {
  schema.pre("save", async function () {
    if (this.isModified("password")) {
      this.password = await hashIfNeeded(this.password);
    }
    if (this.isModified("otp") && this.otp) {
      this.otp = await hashIfNeeded(this.otp);
    }
  });

  schema.methods.verifyOtp = async function (plainOtp) {
    if (!this.otp || !this.otpExpires) return false;
    if (this.otpExpires.getTime() < Date.now()) return false;

    if (BCRYPT_HASH_PATTERN.test(this.otp)) {
      return bcrypt.compare(String(plainOtp).trim(), this.otp);
    }
    return this.otp === String(plainOtp).trim();
  };

  schema.methods.clearOtp = function () {
    this.otp = undefined;
    this.otpExpires = undefined;
    this.verificationAttempts = 0;
  };
};

module.exports = { attachSecretHashing };
