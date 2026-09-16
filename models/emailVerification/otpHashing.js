"use strict";

const bcrypt = require("bcryptjs");
const { BCRYPT_HASH_PATTERN, isAlreadyHashed } = require("../user/passwordHashing");

const hashIfNeeded = async (value) => {
  if (typeof value !== "string" || isAlreadyHashed(value)) return value;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(value, salt);
};

// Mongoose hooks and instance methods rely on `this`, so they stay function
// expressions rather than arrows.
const attachOtpHashing = (schema) => {
  schema.pre("save", async function () {
    if (this.isModified("otp") && this.otp) {
      this.otp = await hashIfNeeded(this.otp);
    }
  });

  schema.methods.matchesOtp = async function (plainOtp) {
    if (!this.otp || !this.otpExpires) return false;
    if (this.otpExpires.getTime() < Date.now()) return false;

    const candidate = String(plainOtp).trim();
    if (BCRYPT_HASH_PATTERN.test(this.otp)) {
      return bcrypt.compare(candidate, this.otp);
    }
    return this.otp === candidate;
  };
};

module.exports = { attachOtpHashing };
