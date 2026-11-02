"use strict";

const { resolveUserStatus, SIGN_IN_READY_STATUSES } = require("../models/user/userStatus");

const ENV_KEY = "RESIDENT_WEB_ACCESS_ADMIN_ID";
const OBJECT_ID = /^[0-9a-f]{24}$/;

const designatedAdminId = () => {
  const value = String(process.env[ENV_KEY] || "").trim().toLowerCase();
  return OBJECT_ID.test(value) ? value : null;
};

const isDesignatedAdminId = (id) => {
  const designated = designatedAdminId();
  return designated !== null && String(id ?? "").toLowerCase() === designated;
};

const canManageResidentWebAccess = (account) =>
  account?.role === "admin" &&
  SIGN_IN_READY_STATUSES.includes(resolveUserStatus(account)) &&
  isDesignatedAdminId(account._id ?? account.userId);

module.exports = { ENV_KEY, designatedAdminId, canManageResidentWebAccess };
