"use strict";

const SystemLog = require("../models/SystemLog");
const User = require("../models/User");
const {
  normalizeRole,
  getModuleForAction,
  getLogTypeForAction,
  parseUserAgent,
  MODULE_RULES,
} = require("../services/systemLogService");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");

const buildDateRange = (fromDate, toDate) => {
  const range = {};

  if (fromDate) {
    const from = new Date(fromDate);

    if (!Number.isNaN(from.getTime())) {
      range.$gte = from;
    }
  }

  if (toDate) {
    const to = new Date(toDate);

    if (!Number.isNaN(to.getTime())) {
      const endOfDay = new Date(to);
      endOfDay.setHours(23, 59, 59, 999);

      range.$lte = endOfDay;
    }
  }

  return Object.keys(range).length > 0
    ? { createdAt: range }
    : {};
};

const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const VALID_SEVERITIES = ["info", "success", "warning", "error"];

// `userId` is a plain ref on SystemLog, so matching it by the actor's name or
// email needs its own lookup against User first — a $or with dot-notation on
// an unpopulated ref would silently match nothing.
const findMatchingUserIds = async (regex) => {
  const users = await User.find({ $or: [{ fullname: regex }, { email: regex }] })
    .select("_id")
    .lean();
  return users.map((u) => u._id);
};

// "Log Type" in the UI is the human category (User Authentication, User
// Management, ...) that getLogTypeForAction derives from an action prefix,
// not a stored field — so filtering by it means matching every action whose
// prefix rolls up to that category (or, for the "System Event" catch-all,
// every action that matches none of the known prefixes).
const buildLogTypeFilter = (logType) => {
  const rule = MODULE_RULES.find((r) => r.logType === logType);
  if (rule) return { action: rule.test };

  if (logType === "System Event") {
    return { $nor: MODULE_RULES.map((r) => ({ action: r.test })) };
  }

  return {};
};

const buildFilters = async ({ search, role, action, platform, severity, logType, fromDate, toDate }) => {
  const filters = {};

  if (role && role !== "all") {
    filters.role = normalizeRole(String(role).trim());
  }

  if (action && action !== "all") {
    filters.action = String(action).trim().toUpperCase();
  }

  if (platform && platform !== "all") {
    filters.platform = String(platform).trim();
  }

  if (severity && severity !== "all" && VALID_SEVERITIES.includes(String(severity).toLowerCase())) {
    filters.severity = String(severity).toLowerCase();
  }

  if (logType && logType !== "all") {
    Object.assign(filters, buildLogTypeFilter(String(logType)));
  }

  const dateRange = buildDateRange(fromDate, toDate);
  if (Object.keys(dateRange).length > 0) {
    Object.assign(filters, dateRange);
  }

  const queryString = String(search || "").trim();
  if (queryString) {
    const escapedSearch = escapeRegex(queryString);
    const regex = new RegExp(escapedSearch, "i");
    const matchingUserIds = await findMatchingUserIds(regex);

    filters.$or = [
      { action: regex },
      { role: regex },
      { ipAddress: regex },
      { description: regex },
      { resource: regex },
      ...(matchingUserIds.length ? [{ userId: { $in: matchingUserIds } }] : []),
    ];
  }

  return filters;
};

// Shapes one lean SystemLog document (optionally populated with its user)
// into the fields the System Logs UI renders — module/log type/severity
// labels, the actor's display name + email, and a parsed device/browser
// string — without ever forwarding raw metadata that wasn't sanitized.
const serializeLog = (log) => {
  const user = log.userId && typeof log.userId === "object" ? log.userId : null;
  const { device, browser } = parseUserAgent(log.userAgent);

  return {
    _id: log._id,
    createdAt: log.createdAt,
    action: log.action,
    role: log.role,
    ipAddress: log.ipAddress || "unknown",
    platform: log.platform || "Web",
    clientPlatform: log.clientPlatform || "",
    resource: log.resource || "",
    resourceId: log.resourceId || "",
    description: log.description || "",
    success: log.success !== false,
    status: log.success !== false ? "Success" : "Failed",
    severity: log.severity || "info",
    module: getModuleForAction(log.action),
    logType: getLogTypeForAction(log.action),
    device,
    browser,
    userName: user?.fullname || (log.role === "system" ? "System" : "Unknown User"),
    userEmail: user?.email || "",
    userId: user?._id || log.userId || null,
  };
};

const getSystemLogs = asyncHandler(async (req, res) => {
  const {
    search = "",
    role = "all",
    action = "all",
    platform = "all",
    severity = "all",
    logType = "all",
    fromDate,
    toDate,
    page = 1,
    limit = 25,
    sort = "desc",
  } = req.query;

  const filters = await buildFilters({ search, role, action, platform, severity, logType, fromDate, toDate });

  // Pagination
  const pageNumber = Math.max(1, Number(page) || 1);
  const pageLimit = Math.min(
    100,
    Math.max(1, Number(limit) || 25)
  );

  const skip = (pageNumber - 1) * pageLimit;

  // Sorting
  const sortOrder = String(sort).toLowerCase() === "asc" ? 1 : -1;

  // Fetch logs and total count simultaneously
  const [logs, total] = await Promise.all([
    SystemLog.find(filters)
      .sort({ createdAt: sortOrder })
      .skip(skip)
      .limit(pageLimit)
      .populate("userId", "fullname email")
      .lean(),

    SystemLog.countDocuments(filters),
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(total / pageLimit)
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "System logs loaded successfully.",
    count: logs.length,
    total,
    page: pageNumber,
    limit: pageLimit,
    totalPages,
    logs: logs.map(serializeLog),
  });
});

// Powers the four summary cards on the System Logs page: current totals plus
// a percentage delta against the prior comparable period for each one.
const getSystemLogStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);
  const startOfPrevWeek = new Date(startOfToday.getTime() - 13 * 86400000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const percentChange = (current, previous) => {
    if (previous <= 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  const [
    totalLogs,
    totalLogsPrevMonth,
    totalLogsThisMonth,
    errorsToday,
    errorsYesterday,
    warningsThisWeek,
    warningsPrevWeek,
    successThisMonth,
    successPrevMonth,
  ] = await Promise.all([
    SystemLog.countDocuments({}),
    SystemLog.countDocuments({ createdAt: { $gte: startOfPrevMonth, $lt: startOfMonth } }),
    SystemLog.countDocuments({ createdAt: { $gte: startOfMonth } }),
    SystemLog.countDocuments({ severity: "error", createdAt: { $gte: startOfToday } }),
    SystemLog.countDocuments({ severity: "error", createdAt: { $gte: startOfYesterday, $lt: startOfToday } }),
    SystemLog.countDocuments({ severity: "warning", createdAt: { $gte: startOfWeek } }),
    SystemLog.countDocuments({ severity: "warning", createdAt: { $gte: startOfPrevWeek, $lt: startOfWeek } }),
    SystemLog.countDocuments({ success: true, createdAt: { $gte: startOfMonth } }),
    SystemLog.countDocuments({ success: true, createdAt: { $gte: startOfPrevMonth, $lt: startOfMonth } }),
  ]);

  const successfulActions = await SystemLog.countDocuments({ success: true });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    stats: {
      totalLogs: {
        value: totalLogs,
        change: percentChange(totalLogsThisMonth, totalLogsPrevMonth),
        direction: totalLogsThisMonth >= totalLogsPrevMonth ? "up" : "down",
        comparisonLabel: "vs. last month",
      },
      errorsToday: {
        value: errorsToday,
        change: percentChange(errorsToday, errorsYesterday),
        direction: errorsToday <= errorsYesterday ? "down" : "up",
        comparisonLabel: "vs. yesterday",
      },
      warnings: {
        value: warningsThisWeek,
        change: percentChange(warningsThisWeek, warningsPrevWeek),
        direction: warningsThisWeek <= warningsPrevWeek ? "down" : "up",
        comparisonLabel: "vs. last week",
      },
      successfulActions: {
        value: successfulActions,
        change: percentChange(successThisMonth, successPrevMonth),
        direction: successThisMonth >= successPrevMonth ? "up" : "down",
        comparisonLabel: "vs. last month",
      },
    },
  });
});

const csvCell = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// Streams a CSV of every log matching the current filters (capped so an
// unfiltered export of a very large collection can't exhaust memory).
const EXPORT_ROW_CAP = 10000;

const exportSystemLogs = asyncHandler(async (req, res) => {
  const {
    search = "",
    role = "all",
    action = "all",
    platform = "all",
    severity = "all",
    logType = "all",
    fromDate,
    toDate,
    sort = "desc",
  } = req.query;

  const filters = await buildFilters({ search, role, action, platform, severity, logType, fromDate, toDate });
  const sortOrder = String(sort).toLowerCase() === "asc" ? 1 : -1;

  const logs = await SystemLog.find(filters)
    .sort({ createdAt: sortOrder })
    .limit(EXPORT_ROW_CAP)
    .populate("userId", "fullname email")
    .lean();

  const rows = logs.map(serializeLog);

  const header = [
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

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
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
        .join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(HTTP_STATUS.OK).send(csv);
});

module.exports = {
  getSystemLogs,
  getSystemLogStats,
  exportSystemLogs,
};
