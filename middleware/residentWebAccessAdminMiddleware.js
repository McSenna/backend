"use strict";

const { canManageResidentWebAccess, designatedAdminId } = require("../config/residentWebAccessAdmin");
const { createSystemLog } = require("../services/systemLogService");
const { forbidden } = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");
const { ERROR_CODES } = require("../utils/errorCodes");
const { isValidObjectId } = require("../utils/objectId");

const READS = ["GET", "HEAD"];

/** Runs after auth, which reloads the account from the database, so nothing here comes from the client. */
const requireResidentWebAccessAdmin = asyncHandler(async (req, _res, next) => {
  if (canManageResidentWebAccess(req.user)) return next();
  if (!READS.includes(req.method)) {
    await createSystemLog({
      req,
      action: "RESIDENT_WEB_ACCESS_DENIED",
      description: "Refused a resident web access change from an account without the permission",
      resource: "User",
      resourceId: isValidObjectId(req.params.id) ? req.params.id : "",
      success: false,
      metadata: { reason: designatedAdminId() ? "not_designated" : "not_configured" },
    });
  }
  throw forbidden(
    "Only the designated administrator can manage resident web access.",
    ERROR_CODES.RESIDENT_WEB_ACCESS_ADMIN_REQUIRED,
  );
});

module.exports = requireResidentWebAccessAdmin;
