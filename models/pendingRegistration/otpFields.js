"use strict";

const otpFields = {
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
};

module.exports = { otpFields };
