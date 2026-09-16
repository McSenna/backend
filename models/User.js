"use strict";

const mongoose = require("mongoose");
const { identityFields } = require("./user/identityFields");
const { contactFields } = require("./user/contactFields");
const { accountFields } = require("./user/accountFields");
const { attachPasswordHashing } = require("./user/passwordHashing");
const { VALID_STATUSES, BLOCKED_STATUSES, resolveUserStatus } = require("./user/userStatus");

const UserSchema = new mongoose.Schema(
  {
    ...identityFields,
    ...contactFields,
    ...accountFields,
  },
  {
    timestamps: true,
    collection: "resident",
  }
);

UserSchema.index({ role: 1, verified: 1 });
UserSchema.index({ organizationId: 1 });

UserSchema.pre("validate", function () {
  if (this.gender) {
    this.gender = this.gender.toLowerCase().trim();
  }
});

attachPasswordHashing(UserSchema);

UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  return user;
};

const User = mongoose.model("User", UserSchema, "users");

module.exports = User;
module.exports.VALID_STATUSES = VALID_STATUSES;
module.exports.BLOCKED_STATUSES = BLOCKED_STATUSES;
module.exports.resolveUserStatus = resolveUserStatus;
