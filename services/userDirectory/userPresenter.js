"use strict";

const { resolveUserStatus } = require("../../models/user/userStatus");
const { describePlatformAccess } = require("../../config/platformAccess");

const serializeUser = (user) => ({
  ...user,
  phone: user.phone || "",
  status: resolveUserStatus(user),
  platformAccess: describePlatformAccess(user.role),
  lastLogin: user.lastLogin || null,
});

module.exports = { serializeUser };
