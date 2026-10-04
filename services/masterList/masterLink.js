"use strict";

const MasterResident = require("../../models/MasterResident");
const User = require("../../models/User");
const { MATCH_OUTCOMES } = require("../../config/masterList");

// True when a save failed because another account already holds the same
// master record (the partial unique index on users.masterResidentId).
const isLinkCollision = (error) =>
  error?.code === 11000 && Boolean(error?.keyPattern?.masterResidentId);

// An admin approval links the account only when sign-up found exactly one
// clean match, the record is still active, and no other account holds it.
// Anything less is approved without a link rather than guessed.
const findLinkableRecordId = async ({ masterListCheck, userId }) => {
  const candidateIds = masterListCheck?.candidateIds ?? [];
  if (masterListCheck?.outcome !== MATCH_OUTCOMES.MATCHED || candidateIds.length !== 1) {
    return null;
  }

  const [candidateId] = candidateIds;
  const [record, otherAccount] = await Promise.all([
    MasterResident.exists({ masterResidentId: candidateId, isActive: true }),
    User.exists({ masterResidentId: candidateId, _id: { $ne: userId } }),
  ]);

  return record && !otherAccount ? candidateId : null;
};

// Why a record an admin picked cannot be linked to this account, or null when
// it can: it must be active and not already held by another account.
const linkBlockerFor = async ({ masterResidentId, userId }) => {
  const [record, otherAccount] = await Promise.all([
    MasterResident.exists({ masterResidentId, isActive: true }),
    User.exists({ masterResidentId, _id: { $ne: userId } }),
  ]);
  if (!record) return "inactive_or_missing";
  if (otherAccount) return "held_by_another_account";
  return null;
};

module.exports = { isLinkCollision, findLinkableRecordId, linkBlockerFor };
