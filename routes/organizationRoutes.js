"use strict";

const express = require("express");

const Organization = require("../models/organization");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");

const router = express.Router();

router.get(
  "/organizations",
  asyncHandler(async (_req, res) => {
    const members = await Organization.find().lean();
    return res.status(HTTP_STATUS.OK).json(members);
  })
);

module.exports = router;
