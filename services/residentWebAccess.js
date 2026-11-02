"use strict";
const Policy = require("../models/ResidentWebPolicy");
const User = require("../models/User");
const {
  resolveUserStatus,
  SIGN_IN_READY_STATUSES,
} = require("../models/user/userStatus");
const { forbidden, serviceUnavailable } = require("../utils/AppError");

const initializeResidentWebAccess = async () => {
  await Policy.updateOne(
    { _id: "resident-web" },
    { $setOnInsert: { enabled: false, revision: 0 } },
    { upsert: true, timestamps: false },
  );
};
const readPolicy = () => Policy.findById("resident-web").lean();
const policyView = (policy) => ({
  initialized: Boolean(policy),
  enabled: policy?.enabled === true,
  revision: policy?.revision ?? 0,
});
const STATE_REASONS = {
  unavailable: "Web access policy is unavailable. Ask an administrator to restore it.",
  ineligible: "Blocked by account eligibility. Web access does not approve or reactivate accounts.",
  individual_blocked: "Web access is blocked for this resident.",
  exception_allowed: "Allowed by this resident's individual setting, although the global setting is off.",
  individual_allowed: "Allowed by this resident's individual setting.",
  global_allowed: "Allowed by the global setting.",
  global_blocked: "Blocked by the global setting.",
};
const ALLOWED_STATES = ["exception_allowed", "individual_allowed", "global_allowed"];
const stateOf = ({ policy, eligible, override, globalEnabled }) => {
  if (!policy) return "unavailable";
  if (!eligible) return "ineligible";
  if (override === "block") return "individual_blocked";
  if (override === "allow") return globalEnabled ? "individual_allowed" : "exception_allowed";
  return globalEnabled ? "global_allowed" : "global_blocked";
};
const accessView = (user, policy) => {
  const eligible = SIGN_IN_READY_STATUSES.includes(resolveUserStatus(user));
  const override = user.residentWebAccessOverride ?? null;
  const globalEnabled = policy?.enabled === true;
  const state = stateOf({ policy, eligible, override, globalEnabled });
  return {
    override,
    globalEnabled,
    eligible,
    effective: ALLOWED_STATES.includes(state),
    state,
    reason: STATE_REASONS[state],
    revision: user.webAccessRevision ?? 0,
  };
};
const assertResidentWebAccess = async (user) => {
  const policy = await readPolicy();
  if (!policy || typeof policy.enabled !== "boolean")
    throw serviceUnavailable(
      "Resident web access cannot be verified. Please try again later or contact the health center.",
    );
  if (!accessView(user, policy).effective)
    throw forbidden(
      "Your resident web access is disabled. Contact the barangay health center for help. Managed mobile access is unchanged.",
      "RESIDENT_WEB_ACCESS_DENIED",
    );
};
const describeAccountAccess = (user, policy) => {
  const base = require("../config/platformAccess").describePlatformAccess(
    user.role,
  );
  if (user.role !== "resident") return base;
  const web = accessView(user, policy).effective;
  return {
    ...base,
    web,
    allowedPlatforms: web ? ["web", "mobile"] : ["mobile"],
    label: web ? "Web + Mobile" : "Mobile Only",
  };
};
module.exports = {
  describeAccountAccess,
  initializeResidentWebAccess,
  readPolicy,
  policyView,
  accessView,
  assertResidentWebAccess,
};
