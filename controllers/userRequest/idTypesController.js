"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { SUPPORTED_ID_TYPES, REJECTION_REASONS } = require("../../config/idVerification");

exports.getIdTypes = asyncHandler(async (_req, res) =>
  res.status(HTTP_STATUS.OK).json({
    success: true,
    idTypes: SUPPORTED_ID_TYPES,
    rejectionReasons: REJECTION_REASONS,
  })
);
