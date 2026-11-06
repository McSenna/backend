"use strict";
const { assertResidentWebAccess } = require("../residentWebAccess");

// Residents sign in on the mobile app with their email and password only. The
// web policy applies to every other platform, so a browser is always checked.
const authorizeResidentLogin = async (user, platform) => {
  if (user.role !== "resident" || platform === "mobile") return;
  await assertResidentWebAccess(user);
};
module.exports = { authorizeResidentLogin };
