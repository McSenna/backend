"use strict";

const SystemLog = require("../../models/SystemLog");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { buildFilters, readLogQuery, sortOrderOf } = require("../../services/systemLog/logFilters");
const { serializeLog } = require("../../services/systemLog/logPresenter");

const EXPORT_ROW_CAP = 10000;

const CSV_HEADER = [
  "Timestamp",
  "User",
  "Email",
  "Role",
  "Action",
  "Module",
  "Severity",
  "IP Address",
  "Status",
  "Device",
  "Browser",
  "Log Type",
];

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsvRow = (row) =>
  [
    new Date(row.createdAt).toISOString(),
    row.userName,
    row.userEmail,
    row.role,
    row.action,
    row.module,
    row.severity,
    row.ipAddress,
    row.status,
    row.device,
    row.browser,
    row.logType,
  ]
    .map(csvCell)
    .join(",");

exports.exportSystemLogs = asyncHandler(async (req, res) => {
  const filters = await buildFilters(readLogQuery(req.query));

  const logs = await SystemLog.find(filters)
    .sort({ createdAt: sortOrderOf(req.query.sort) })
    .limit(EXPORT_ROW_CAP)
    .populate("userId", "fullname email")
    .lean();

  const csv = [CSV_HEADER.join(","), ...logs.map(serializeLog).map(toCsvRow)].join("\n");
  const filename = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(HTTP_STATUS.OK).send(csv);
});
