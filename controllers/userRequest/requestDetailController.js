"use strict";

const ResidentVerification = require("../../models/ResidentVerification");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS, ERROR_CODES } = require("../../utils/errorCodes");
const { badRequest, notFound } = require("../../utils/AppError");
const { isValidObjectId } = require("../../utils/objectId");
const {
  DETAIL_USER_FIELDS,
  toDetail,
} = require("../../services/userRequest/verificationPresenter");

const withRelations = (query) =>
  query.populate("user", DETAIL_USER_FIELDS).populate("verifiedBy", "fullname email").lean();

exports.getUserRequestById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw badRequest("A valid request ID is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  const verification =
    (await withRelations(ResidentVerification.findById(id))) ??
    (await withRelations(ResidentVerification.findOne({ user: id })));

  if (!verification) {
    throw notFound("Registration verification request not found.", ERROR_CODES.NOT_FOUND);
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    request: toDetail(verification),
  });
});
