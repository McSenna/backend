"use strict";
const crypto = require("crypto");
const ManagedDevice = require("../models/ManagedDevice");
const { forbidden } = require("../utils/AppError");
const { isValidObjectId } = require("../utils/objectId");
const credentialError = () =>
  forbidden(
    "This resident mobile session needs an administrator-provisioned device credential. Ask the health center to provision this device, then sign in again.",
    "DEVICE_CREDENTIAL_REQUIRED",
  );
const hash = (secret) =>
  crypto.createHash("sha256").update(secret).digest("hex");
const deviceView = (device) => ({
  id: String(device._id),
  createdAt: device.createdAt,
  revokedAt: device.revokedAt,
});
const provisionDevice = async (residentId, adminId) => {
  const secret = crypto.randomBytes(32).toString("hex");
  const device = await ManagedDevice.create({
    residentId,
    createdBy: adminId,
    credentialHash: hash(secret),
  });
  return { device: deviceView(device), credential: `${device._id}.${secret}` };
};
const verifyDeviceCredential = async (residentId, credential) => {
  if (
    typeof credential !== "string" ||
    !/^[a-f0-9]{24}\.[a-f0-9]{64}$/.test(credential)
  )
    throw credentialError();
  const [id, secret] = credential.split(".");
  const device = await ManagedDevice.findOne({
    _id: id,
    residentId,
    revokedAt: null,
  })
    .select("+credentialHash")
    .lean();
  if (
    !device ||
    !crypto.timingSafeEqual(
      Buffer.from(device.credentialHash, "hex"),
      Buffer.from(hash(secret), "hex"),
    )
  )
    throw credentialError();
  return String(device._id);
};
const assertManagedSession = async (residentId, deviceId) => {
  if (
    !isValidObjectId(deviceId) ||
    !(await ManagedDevice.exists({
      _id: deviceId,
      residentId,
      revokedAt: null,
    }))
  )
    throw credentialError();
};
module.exports = {
  credentialError,
  deviceView,
  provisionDevice,
  verifyDeviceCredential,
  assertManagedSession,
};
