"use strict";

const SystemLog = require("../../models/SystemLog");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");

const BRAND_LIMIT = 50;

/** The brands the brand filter can offer: every brand some entry was logged from. */
exports.getSystemLogDeviceBrands = asyncHandler(async (_req, res) => {
  const rows = await SystemLog.aggregate([
    { $match: { "device.brandKey": { $type: "string" } } },
    { $group: { _id: "$device.brandKey", label: { $first: "$device.brand" } } },
    { $sort: { _id: 1 } },
    { $limit: BRAND_LIMIT },
  ]);
  res.status(HTTP_STATUS.OK).json({
    success: true,
    brands: rows.map((row) => ({ value: row._id, label: row.label || row._id })),
  });
});
