"use strict";

const { describeAccountAccess } = require("../residentWebAccess");
const { resolveRequestPlatform } = require("../platformService");

const buildUserResponse = (user, policy = null) => ({
  _id: user._id,
  fullname: user.fullname,
  email: user.email,
  role: user.role,
  verified: user.verified,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  firstName: user.firstName || "",
  middleName: user.middleName || "",
  surname: user.surname || "",
  suffix: user.suffix || "",
  civilStatus: user.civilStatus || "",
  address: user.address,
  addressDetails: user.addressDetails ?? null,
  phone: user.phone || "",
  avatarUrl: user.profilePhoto || null,
  platformAccess: describeAccountAccess(user, policy),
});

const platformOf = (req) => (req.clientPlatform || resolveRequestPlatform(req)).platform;

module.exports = { buildUserResponse, platformOf };
