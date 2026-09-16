"use strict";

const crypto = require("crypto");

const generateOTP = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

const generateOTPWithExpiry = (expiryMinutes = 5) => ({
  otp: generateOTP(),
  expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
});

const isOTPExpired = (expiresAt) => new Date() > new Date(expiresAt);

const verifyOTP = (providedOTP, storedOTP, expiresAt) =>
  providedOTP === storedOTP && !isOTPExpired(expiresAt);

module.exports = { generateOTP, generateOTPWithExpiry, verifyOTP, isOTPExpired };
