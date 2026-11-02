"use strict";
const ManagedDevice = require("../models/ManagedDevice");
const { resident } = require("./residentWebAccessController");
const { deviceView, provisionDevice } = require("../services/managedDevices");
const { badRequest, notFound } = require("../utils/AppError");
const { isValidObjectId } = require("../utils/objectId");
const asyncHandler = require("../utils/asyncHandler");
const { createSystemLog } = require("../services/systemLogService");
const {
  disconnectManagedDevice,
} = require("../realtime/residentAuthorization");
const audit = (req, action, id) =>
  createSystemLog({
    req,
    action,
    description: "Admin changed a managed mobile device credential",
    resource: "ManagedDevice",
    resourceId: id,
    metadata: { residentId: req.params.id },
  });
exports.list = asyncHandler(async (req, res) => {
  await resident(req.params.id);
  const devices = await ManagedDevice.find({ residentId: req.params.id })
    .sort({ createdAt: -1 })
    .lean();
  res.set("Cache-Control", "no-store");
  res.json({ success: true, devices: devices.map(deviceView) });
});
exports.provision = asyncHandler(async (req, res) => {
  await resident(req.params.id);
  const result = await provisionDevice(req.params.id, req.user.userId);
  await audit(req, "MANAGED_DEVICE_PROVISIONED", result.device.id);
  res.set("Cache-Control", "no-store");
  res.status(201).json({ success: true, ...result });
});
exports.revoke = asyncHandler(async (req, res) => {
  await resident(req.params.id);
  if (!isValidObjectId(req.params.deviceId))
    throw badRequest("A valid device id is required.");
  const device = await ManagedDevice.findOneAndUpdate(
    { _id: req.params.deviceId, residentId: req.params.id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!device)
    throw notFound("Active managed device not found. Reload the device list.");
  disconnectManagedDevice(String(device._id));
  await audit(req, "MANAGED_DEVICE_REVOKED", String(device._id));
  res.json({ success: true, device: deviceView(device) });
});
