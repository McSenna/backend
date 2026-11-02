"use strict";

const User = require("../../models/User");
const { resolveUserStatus, SIGN_IN_READY_STATUSES } = require("../../models/user/userStatus");
const { disconnectUser } = require("../../realtime/socketServer");
const { issueResetCode } = require("../../services/passwordReset/resetCodeService");
const { buildProfileUpdate, namePartsFromFullName } = require("../../services/profile/profileUpdateBuilder");
const { readPolicy } = require("../../services/residentWebAccess");
const { createSystemLog } = require("../../services/systemLogService");
const { assertAdminChangeAllowed, assertAdminRemains } = require("../../services/userDirectory/adminGuards");
const { serializeUserRow } = require("../../services/userDirectory/userPresenter");
const AppError = require("../../utils/AppError");
const asyncHandler = require("../../utils/asyncHandler");
const { badRequest, conflict, forbidden, notFound } = AppError;
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");

const EDITABLE = ["fullname", "phone", "address"];
const STAFF_ROLES = ["admin", "doctor", "midwife", "bhw"];
const FIELDS = "fullname firstName middleName surname suffix email role status verified updatedAt phone address";

const loadTarget = async (id) => {
  if (!isValidObjectId(id)) throw badRequest("A valid user id is required.", ERROR_CODES.VALIDATION_ERROR);
  const user = await User.findById(id).select(FIELDS).lean();
  if (!user) throw notFound("User not found.", ERROR_CODES.USER_NOT_FOUND);
  return user;
};

const readVersion = (body) => {
  const version = typeof body.updatedAt === "string" ? new Date(body.updatedAt) : null;
  if (body.updatedAt !== null && Number.isNaN(version?.getTime() ?? NaN)) {
    throw badRequest("Send the updatedAt value this form was opened with.", ERROR_CODES.VALIDATION_ERROR);
  }
  return version;
};

const staleSave = () => conflict("This account changed in another session. Reload it and try again.", ERROR_CODES.CONFLICT);

const saveIfUnchanged = async (id, version, update) => {
  const saved = await User.findOneAndUpdate(
    { _id: id, updatedAt: version },
    { $set: update },
    { returnDocument: "after", runValidators: true },
  )
    .select("-password")
    .lean();
  if (!saved) throw staleSave();
  return saved;
};

const respondWithRow = async (res, user) =>
  res.status(HTTP_STATUS.OK).json({ success: true, user: serializeUserRow(user, await readPolicy()) });

exports.updateUser = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const unknown = Object.keys(body).filter((key) => key !== "updatedAt" && !EDITABLE.includes(key));
  if (unknown.length > 0) throw badRequest("Only name, phone and address can be edited here.", ERROR_CODES.VALIDATION_ERROR);
  const version = readVersion(body);
  const current = await loadTarget(req.params.id);

  const update = buildProfileUpdate(Object.fromEntries(EDITABLE.filter((key) => key in body).map((key) => [key, body[key]])), current);
  // The resident's own edit form rebuilds the full name from these, which would undo the correction.
  if (update.fullname && (current.firstName || current.surname)) Object.assign(update, namePartsFromFullName(update.fullname, current.suffix));
  const fields = Object.keys(update).filter((key) => update[key] !== current[key]);
  const saved = await saveIfUnchanged(req.params.id, version, update);

  await createSystemLog({
    req,
    action: "USER_UPDATED",
    role: req.user.role,
    description: `Admin updated the account of ${saved.fullname}`,
    resource: "User",
    resourceId: String(saved._id),
    metadata: { targetUserId: String(saved._id), fields },
  });
  return respondWithRow(res, saved);
});

exports.updateUserRole = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const version = readVersion(body);
  if (body.role === "resident") throw conflict("A staff account cannot become a resident account.", ERROR_CODES.CONFLICT);
  if (!STAFF_ROLES.includes(body.role)) throw badRequest("Role must be admin, doctor, midwife or BHW.", ERROR_CODES.VALIDATION_ERROR);

  const current = await loadTarget(req.params.id);
  if (current.role === "resident") throw conflict("A resident account cannot become a staff account.", ERROR_CODES.CONFLICT);
  if (current.role === "admin" && body.role !== "admin") {
    await assertAdminChangeAllowed({ actorId: req.user.userId, target: current });
  }

  const saved = await saveIfUnchanged(req.params.id, version, { role: body.role });
  if (current.role === "admin") {
    await assertAdminRemains(() => User.updateOne({ _id: saved._id }, { $set: { role: current.role } }));
  }
  disconnectUser(String(saved._id));

  await createSystemLog({
    req,
    action: "USER_ROLE_CHANGED",
    role: req.user.role,
    description: `Admin changed the role of ${saved.fullname}`,
    resource: "User",
    resourceId: String(saved._id),
    metadata: { targetUserId: String(saved._id), previousRole: current.role, newRole: saved.role },
  });
  return respondWithRow(res, saved);
});

exports.sendUserPasswordReset = asyncHandler(async (req, res) => {
  const target = await loadTarget(req.params.id);
  if (String(target._id) === String(req.user.userId)) {
    throw forbidden("Use change password on your own profile.", ERROR_CODES.SELF_ACTION_FORBIDDEN);
  }
  if (!SIGN_IN_READY_STATUSES.includes(resolveUserStatus(target))) {
    throw conflict("Only an approved or active account can reset its password.", ERROR_CODES.CONFLICT);
  }

  try {
    await issueResetCode(target.email, req, { requireDelivery: true });
  } catch (error) {
    if (error?.statusCode === HTTP_STATUS.TOO_MANY_REQUESTS) throw error;
    // The service already removed the code, so nothing was sent and nothing is left to use.
    throw new AppError("The reset email could not be sent. Check the email service, then try again.", HTTP_STATUS.BAD_GATEWAY, ERROR_CODES.EMAIL_SEND_FAILED);
  }

  await createSystemLog({
    req,
    action: "USER_PASSWORD_RESET_SENT",
    role: req.user.role,
    description: `Admin sent a password reset code to ${target.fullname}`,
    resource: "User",
    resourceId: String(target._id),
    metadata: { targetUserId: String(target._id) },
  });
  return res.status(HTTP_STATUS.OK).json({ success: true, message: `Reset code sent to ${target.email}.` });
});
