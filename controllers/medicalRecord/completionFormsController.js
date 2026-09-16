"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { getAllCompletionForms } = require("../../config/medicalRecordFields");

exports.getCompletionForms = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    message: "Completion forms loaded successfully.",
    forms: getAllCompletionForms(),
  })
);
