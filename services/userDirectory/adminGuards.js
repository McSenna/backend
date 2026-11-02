"use strict";

const User = require("../../models/User");
const { resolveUserStatus, SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");
const { conflict, forbidden } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { effectiveStatusStage } = require("./userListQuery");

const countSignInReadyAdmins = async () => {
  const [row] = await User.aggregate([
    { $match: { role: "admin" } },
    effectiveStatusStage,
    { $match: { effectiveStatus: { $in: SIGN_IN_READY_STATUSES } } },
    { $count: "value" },
  ]);
  return row?.value ?? 0;
};

const lastAdminError = () =>
  conflict("This is the last admin account that can sign in. Make another account an admin first.", ERROR_CODES.LAST_ADMIN);

/** Before deactivating or demoting: never your own account, never the last admin. */
const assertAdminChangeAllowed = async ({ actorId, target }) => {
  if (String(actorId) === String(target._id)) {
    throw forbidden("You cannot change your own account this way. Ask another admin to do it.", ERROR_CODES.SELF_ACTION_FORBIDDEN);
  }
  const targetIsReadyAdmin = target.role === "admin" && SIGN_IN_READY_STATUSES.includes(resolveUserStatus(target));
  if (targetIsReadyAdmin && (await countSignInReadyAdmins()) <= 1) throw lastAdminError();
};

/**
 * The check above can pass for two admins acting at once, so writes that may
 * remove an admin recount afterwards and undo themselves if none are left.
 */
const assertAdminRemains = async (revert) => {
  if ((await countSignInReadyAdmins()) > 0) return;
  await revert();
  throw lastAdminError();
};

module.exports = { assertAdminChangeAllowed, assertAdminRemains };
