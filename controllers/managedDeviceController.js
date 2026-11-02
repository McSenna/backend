"use strict";
const ManagedDevice = require("../models/ManagedDevice");
const { resident } = require("./residentWebAccessController");
const { deviceView, provisionDevice } = require("../services/managedDevices");
const { badRequest, notFound } = require("../utils/AppError");
const { isValidObjectId } = require("../utils/objectId");
const asyncHandler = require("../utils/asyncHandler");
const { createRequiredSystemLog } = require("../services/systemLogService");
const { runInTransaction } = require("../services/inventory/transactionRunner");
const {
  disconnectManagedDevice,
} = require("../realtime/residentAuthorization");
const audit = (req, action, id, session) =>
  createRequiredSystemLog({
    req,
    session,
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
  const result = await runInTransaction(async (session) => {
    const provisioned = await provisionDevice(req.params.id, req.user.userId, { session });
    await audit(req, "MANAGED_DEVICE_PROVISIONED", provisioned.device.id, session);
    return provisioned;
  }, { required: true });
  res.set("Cache-Control", "no-store");
  res.status(201).json({ success: true, ...result });
});
exports.revoke = asyncHandler(async (req, res) => {
  await resident(req.params.id);
  if (!isValidObjectId(req.params.deviceId))
    throw badRequest("A valid device id is required.");
  const device = await runInTransaction(async (session) => {
    const revoked = await ManagedDevice.findOneAndUpdate(
      { _id: req.params.deviceId, residentId: req.params.id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { returnDocument: "after", session },
    ).lean();
    if (!revoked) throw notFound("Active managed device not found. Reload the device list.");
    await audit(req, "MANAGED_DEVICE_REVOKED", String(revoked._id), session);
    return revoked;
  }, { required: true });
  disconnectManagedDevice(String(device._id));
  res.set("Cache-Control", "no-store");
  res.json({ success: true, device: deviceView(device) });
});
