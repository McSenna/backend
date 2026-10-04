"use strict";

// Admin corrections to which Barangay Master List record an account holds.
// The link decides which encoded medical records the resident sees, so a
// change here never touches a record: unlinking only hides them from this
// account, and linking shows the chosen identity's records. Master list data
// is only checked through services/masterList/masterLink.js.

const User = require("../../models/User");
const { badRequest, conflict, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { isLinkCollision, linkBlockerFor } = require("../masterList/masterLink");

const MASTER_ID = /^[A-Za-z0-9-]{3,40}$/;

const BLOCKER_MESSAGES = Object.freeze({
  inactive_or_missing: "That master list record is not active. Choose an active record.",
  held_by_another_account: "That master list record is already linked to another account.",
});

const readReason = (reason) => {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) throw badRequest("Say why this link is being changed.", ERROR_CODES.VALIDATION_ERROR);
  if (text.length > 500) throw badRequest("Keep the reason to 500 characters or fewer.", ERROR_CODES.VALIDATION_ERROR);
  return text;
};

const readMasterId = (value) => {
  const id = typeof value === "string" ? value.trim() : "";
  if (!MASTER_ID.test(id)) throw badRequest("Choose a master list record to link.", ERROR_CODES.VALIDATION_ERROR);
  return id;
};

const loadResidentAccount = async (userId) => {
  if (!isValidObjectId(userId)) throw badRequest("A valid account ID is required.", ERROR_CODES.INVALID_ID);
  const user = await User.findById(userId);
  if (!user || user.role !== "resident") throw notFound("Resident account not found.", ERROR_CODES.USER_NOT_FOUND);
  return user;
};

// Throws when the chosen record cannot back this account.
const assertLinkable = async (masterResidentId, userId) => {
  const blocker = await linkBlockerFor({ masterResidentId, userId });
  if (blocker) throw conflict(BLOCKER_MESSAGES[blocker], ERROR_CODES.CONFLICT);
};

const linkAccount = async ({ userId, masterResidentId, reason }) => {
  const id = readMasterId(masterResidentId);
  const why = readReason(reason);
  const user = await loadResidentAccount(userId);
  if (user.status !== "approved") {
    throw conflict("Only approved accounts can be linked. Review the user request first.", ERROR_CODES.CONFLICT);
  }
  if (user.masterResidentId) {
    throw conflict("This account is already linked. Unlink it before choosing another record.", ERROR_CODES.CONFLICT);
  }
  await assertLinkable(id, user._id);

  user.masterResidentId = id;
  try {
    await user.save();
  } catch (error) {
    if (isLinkCollision(error)) throw conflict(BLOCKER_MESSAGES.held_by_another_account, ERROR_CODES.CONFLICT);
    throw error;
  }
  return { user, masterResidentId: id, reason: why };
};

const unlinkAccount = async ({ userId, reason }) => {
  const why = readReason(reason);
  const user = await loadResidentAccount(userId);
  const previous = user.masterResidentId;
  if (!previous) throw conflict("This account is not linked to a master list record.", ERROR_CODES.CONFLICT);

  user.masterResidentId = undefined;
  await user.save();
  return { user, previousMasterResidentId: previous, reason: why };
};

module.exports = { linkAccount, unlinkAccount, assertLinkable, BLOCKER_MESSAGES };
