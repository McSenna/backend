"use strict";
// Domain-workflow fixtures represent devices provisioned before use. The web
// policy integration suite separately exercises the actual admin-only routes.
const { provisionDevice } = require("../../../services/managedDevices");
const User = require("../../../models/User");
const fixtures = new Map();
const provisionTestDevice = async (user) => {
  if (!user || user.role !== "resident") return null;
  const key = String(user._id);
  if (!fixtures.has(key))
    fixtures.set(key, await provisionDevice(user._id, user._id));
  return fixtures.get(key).device.id;
};
const deviceIdFor = (user) => fixtures.get(String(user._id))?.device.id ?? null;
const managedLoginBody = async (body) => {
  const user = await User.findOne({
    email: String(body.email).trim().toLowerCase(),
  }).lean();
  if (!user || user.role !== "resident") return body;
  await provisionTestDevice(user);
  return {
    ...body,
    deviceCredential: fixtures.get(String(user._id)).credential,
  };
};
module.exports = { provisionTestDevice, deviceIdFor, managedLoginBody };
