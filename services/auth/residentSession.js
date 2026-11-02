"use strict";
const { verifyDeviceCredential } = require("../managedDevices");
const { assertResidentWebAccess } = require("../residentWebAccess");

// Residents use the Android app with no per-device setup. A credential is
// optional, but one that is sent must be valid, so a revoked device is refused.
const authorizeResidentLogin = async (user, platform, req) => {
  if (user.role !== "resident") return null;
  if (platform === "mobile")
    // The app sends null when nothing is saved on the device.
    return req.body?.deviceCredential == null
      ? null
      : verifyDeviceCredential(user._id, req.body.deviceCredential);
  await assertResidentWebAccess(user);
  return null;
};
module.exports = { authorizeResidentLogin };
