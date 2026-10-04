"use strict";

// Turns a master list check into the account and review-record fields for a new
// resident. Every value here comes from the server: client-supplied status,
// method or master record fields never reach this module.

const User = require("../../models/User");
const {
  isMasterListAutoVerifyEnabled,
  MATCH_OUTCOMES,
  VERIFICATION_METHODS,
} = require("../../config/masterList");
const { isLinkCollision } = require("../masterList/masterLink");

const pendingReview = () => ({
  verified: false,
  userFields: {
    status: "pending",
    verified: false,
    verificationMethod: VERIFICATION_METHODS.ADMIN_REVIEW,
  },
  verificationFields: {
    verificationStatus: "pending",
    verificationMethod: VERIFICATION_METHODS.ADMIN_REVIEW,
  },
});

// verifiedBy and approved_by stay null: the system, not an admin, decided.
const verifiedByMasterList = (masterResidentId, now) => ({
  verified: true,
  userFields: {
    status: "approved",
    verified: true,
    verificationMethod: VERIFICATION_METHODS.MASTER_LIST,
    masterResidentId,
    approved_at: now,
    approved_by: null,
  },
  verificationFields: {
    verificationStatus: "approved",
    verificationMethod: VERIFICATION_METHODS.MASTER_LIST,
    verifiedAt: now,
    verifiedBy: null,
  },
});

const decideRegistration = (masterListCheck, now = new Date()) =>
  masterListCheck.outcome === MATCH_OUTCOMES.MATCHED && isMasterListAutoVerifyEnabled()
    ? verifiedByMasterList(masterListCheck.candidateIds[0], now)
    : pendingReview();

// Two sign-ups can match the same record at the same moment. The unique index
// lets only one of them link; the other is created for admin review instead.
const createResidentAccount = async ({ accountFields, masterListCheck }) => {
  const decision = decideRegistration(masterListCheck);

  try {
    const user = await User.create({ ...accountFields, ...decision.userFields });
    return { user, decision, masterListCheck };
  } catch (error) {
    if (!isLinkCollision(error)) throw error;

    const linkedCheck = { ...masterListCheck, outcome: MATCH_OUTCOMES.ALREADY_LINKED };
    const fallback = pendingReview();
    const user = await User.create({ ...accountFields, ...fallback.userFields });
    return { user, decision: fallback, masterListCheck: linkedCheck };
  }
};

module.exports = { decideRegistration, createResidentAccount };
