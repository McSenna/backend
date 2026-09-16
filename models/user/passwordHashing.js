"use strict";

const bcrypt = require("bcryptjs");

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const isAlreadyHashed = (value) =>
  typeof value === "string" && BCRYPT_HASH_PATTERN.test(value);

// Mongoose hooks and instance methods need `this`, so they stay function
// expressions rather than arrows.
const attachPasswordHashing = (schema) => {
  schema.pre("save", async function () {
    if (!this.isModified("password")) return;
    if (isAlreadyHashed(this.password)) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  });

  schema.methods.comparePassword = async function (passwordInput) {
    return bcrypt.compare(passwordInput, this.password);
  };
};

module.exports = { BCRYPT_HASH_PATTERN, isAlreadyHashed, attachPasswordHashing };
