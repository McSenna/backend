"use strict";

const mongoose = require("mongoose");
const { profileFields } = require("./pendingRegistration/profileFields");
const { otpFields } = require("./pendingRegistration/otpFields");
const { attachSecretHashing } = require("./pendingRegistration/otpHashing");

const HIDDEN_ON_SERIALIZE = [
  "password",
  "otp",
  "otpExpires",
  "lastOtpSentAt",
  "verificationAttempts",
];

const PendingRegistrationSchema = new mongoose.Schema(
  {
    ...profileFields,
    ...otpFields,
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

attachSecretHashing(PendingRegistrationSchema);

PendingRegistrationSchema.methods.toJSON = function () {
  const doc = this.toObject();
  for (const field of HIDDEN_ON_SERIALIZE) delete doc[field];
  return doc;
};

module.exports = mongoose.model(
  "PendingRegistration",
  PendingRegistrationSchema,
  "pending_registrations"
);
