"use strict";

const { readPolicy } = require("../services/residentWebAccess");
const { applyStatusAction } = require("../services/userDirectory/accountActions");
const { serializeUserRow } = require("../services/userDirectory/userPresenter");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");
const { getAllUsers, getUserSummary, getUserById } = require("./user/userListController");

exports.updateUserStatus = asyncHandler(async (req, res) => {
  const user = await applyStatusAction({ req, id: req.params.id, body: req.body });
  return res.status(HTTP_STATUS.OK).json({ success: true, user: serializeUserRow(user, await readPolicy()) });
});

exports.getAllUsers = getAllUsers;
exports.getUserSummary = getUserSummary;
exports.getUserById = getUserById;
