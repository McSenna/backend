"use strict";

const express = require("express");

const Organization = require("../models/organization");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");

const router = express.Router();

// Returns a bare array to match the existing client contract. Failures are
// forwarded to the global handler, which previously leaked the raw Mongoose
// error message straight to the client.
router.get(
  "/organizations",
  asyncHandler(async (_req, res) => {
    const members = await Organization.find().lean();
    return res.status(HTTP_STATUS.OK).json(members);
  })
);

module.exports = router;
