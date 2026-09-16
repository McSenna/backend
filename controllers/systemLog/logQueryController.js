"use strict";

const SystemLog = require("../../models/SystemLog");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { buildFilters, readLogQuery, sortOrderOf } = require("../../services/systemLog/logFilters");
const { serializeLog } = require("../../services/systemLog/logPresenter");

exports.getSystemLogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 25, sort = "desc" } = req.query;

  const filters = await buildFilters(readLogQuery(req.query));

  const pageNumber = Math.max(1, Number(page) || 1);
  const pageLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (pageNumber - 1) * pageLimit;

  const [logs, total] = await Promise.all([
    SystemLog.find(filters)
      .sort({ createdAt: sortOrderOf(sort) })
      .skip(skip)
      .limit(pageLimit)
      .populate("userId", "fullname email")
      .lean(),
    SystemLog.countDocuments(filters),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "System logs loaded successfully.",
    count: logs.length,
    total,
    page: pageNumber,
    limit: pageLimit,
    totalPages: Math.max(1, Math.ceil(total / pageLimit)),
    logs: logs.map(serializeLog),
  });
});
