"use strict";

const { resolveUserStatus, SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");
const { describeAccountAccess, accessView } = require("../residentWebAccess");
const { statusGroupOf } = require("./accountLifecycle");

const staffAccess = (user, policy, status) => {
  const eligible = SIGN_IN_READY_STATUSES.includes(status);
  return {
    web: eligible,
    mobile: eligible,
    override: null,
    globalEnabled: policy?.enabled === true,
    eligible,
    revision: 0,
    state: eligible ? "staff" : "ineligible",
  };
};

const residentAccess = (user, policy) => {
  const { override, globalEnabled, eligible, effective, revision, state } = accessView(user, policy);
  return { web: effective, mobile: eligible, override, globalEnabled, eligible, revision, state };
};

const portalAccessOf = (user, policy, status) =>
  user.role === "resident" ? residentAccess(user, policy) : staffAccess(user, policy, status);

/** A table row. An explicit list, so a new field on the account never reaches the list by accident. */
const serializeUserRow = (user, policy = null) => {
  const status = resolveUserStatus(user);
  return {
    id: String(user._id),
    fullname: user.fullname,
    email: user.email,
    role: user.role,
    status,
    statusGroup: statusGroupOf(status),
    location: user.address || "",
    avatarUrl: user.profilePhoto || null,
    lastLogin: user.lastLogin || null,
    createdAt: user.createdAt ?? null,
    updatedAt: user.updatedAt ?? null,
    verificationId: user.verificationId ? String(user.verificationId) : null,
    portalAccess: portalAccessOf(user, policy, status),
  };
};

/** What the View drawer and Edit dialog read. Never the password or ID files. */
const serializeUserDetail = (user, policy = null) => ({
  ...serializeUserRow(user, policy),
  _id: String(user._id),
  phone: user.phone || "",
  address: user.address || "",
  addressDetails: user.addressDetails ?? null,
  gender: user.gender,
  dateOfBirth: user.dateOfBirth,
  profilePhoto: user.profilePhoto || null,
  verified: user.verified === true,
  masterResidentId: user.masterResidentId,
  verificationMethod: user.verificationMethod || "",
  approved_at: user.approved_at ?? null,
  rejected_at: user.rejected_at ?? null,
  rejection_reason: user.rejection_reason || "",
  rejection_remarks: user.rejection_remarks || "",
  deactivated_at: user.deactivated_at ?? null,
  platformAccess: describeAccountAccess(user, policy),
});

module.exports = { serializeUserRow, serializeUserDetail };
