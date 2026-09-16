"use strict";

const mongoose = require("mongoose");
const { attachOtpHashing } = require("./emailVerification/otpHashing");

const HIDDEN_ON_SERIALIZE = ["otp", "otpExpires", "verificationToken", "attempts"];

const EmailVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    lastOtpSentAt: { type: Date, select: false },
    attempts: { type: Number, default: 0, select: false },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    verificationToken: { type: String, select: false },
    tokenExpires: { type: Date, select: false },
    consumedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

attachOtpHashing(EmailVerificationSchema);

EmailVerificationSchema.methods.toJSON = function () {
  const doc = this.toObject();
  for (const field of HIDDEN_ON_SERIALIZE) delete doc[field];
  return doc;
};

module.exports = mongoose.model(
  "EmailVerification",
  EmailVerificationSchema,
  "email_verifications"
);
