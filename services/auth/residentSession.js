"use strict";
const { verifyDeviceCredential } = require("../managedDevices");
const { assertResidentWebAccess } = require("../residentWebAccess");

// Only administrator-provisioned credentials establish the resident mobile channel.
const authorizeResidentLogin = async (user, platform, req) => {
  if (user.role !== "resident") return null;
  if (platform === "mobile")
    return verifyDeviceCredential(user._id, req.body?.deviceCredential);
  await assertResidentWebAccess(user);
  return null;
};
module.exports = { authorizeResidentLogin };
