"use strict";

const User = require("../../models/User");
const { normalizeRole } = require("./requestContext");
const { MODULE_RULES } = require("./logClassification");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SEVERITIES = ["info", "success", "warning", "error"];

const parseRangeEnd = (value, edge) => {
  const raw = String(value).trim();

  if (DATE_ONLY.test(raw)) {
    const suffix = edge === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const parsed = new Date(`${raw}${suffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildDateRange = (fromDate, toDate) => {
  const range = {};

  if (fromDate) {
    const from = parseRangeEnd(fromDate, "start");
    if (from) range.$gte = from;
  }
  if (toDate) {
    const to = parseRangeEnd(toDate, "end");
    if (to) range.$lte = to;
  }

  return Object.keys(range).length > 0 ? { createdAt: range } : {};
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findMatchingUserIds = async (regex) => {
  const users = await User.find({ $or: [{ fullname: regex }, { email: regex }] })
    .select("_id")
    .lean();
  return users.map((user) => user._id);
};

const buildLogTypeFilter = (logType) => {
  const rule = MODULE_RULES.find((candidate) => candidate.logType === logType);
  if (rule) return { action: rule.test };

  if (logType === "System Event") {
    return { $nor: MODULE_RULES.map((candidate) => ({ action: candidate.test })) };
  }

  return {};
};

const buildSearchFilter = async (search) => {
  const queryString = String(search || "").trim();
  if (!queryString) return null;

  const regex = new RegExp(escapeRegex(queryString), "i");
  const matchingUserIds = await findMatchingUserIds(regex);

  return [
    { action: regex },
    { role: regex },
    { ipAddress: regex },
    { description: regex },
    { resource: regex },
    ...(matchingUserIds.length ? [{ userId: { $in: matchingUserIds } }] : []),
  ];
};

const buildFilters = async ({
  search,
  role,
  action,
  platform,
  severity,
  logType,
  fromDate,
  toDate,
}) => {
  const filters = {};

  if (role && role !== "all") filters.role = normalizeRole(String(role).trim());
  if (action && action !== "all") filters.action = String(action).trim().toUpperCase();
  if (platform && platform !== "all") filters.platform = String(platform).trim();

  if (severity && severity !== "all" && VALID_SEVERITIES.includes(String(severity).toLowerCase())) {
    filters.severity = String(severity).toLowerCase();
  }

  if (logType && logType !== "all") {
    Object.assign(filters, buildLogTypeFilter(String(logType)));
  }

  const dateRange = buildDateRange(fromDate, toDate);
  if (Object.keys(dateRange).length > 0) Object.assign(filters, dateRange);

  const searchFilter = await buildSearchFilter(search);
  if (searchFilter) filters.$or = searchFilter;

  return filters;
};

const readLogQuery = (query) => ({
  search: query.search ?? "",
  role: query.role ?? "all",
  action: query.action ?? "all",
  platform: query.platform ?? "all",
  severity: query.severity ?? "all",
  logType: query.logType ?? "all",
  fromDate: query.fromDate,
  toDate: query.toDate,
});

const sortOrderOf = (sort = "desc") => (String(sort).toLowerCase() === "asc" ? 1 : -1);

module.exports = { buildFilters, readLogQuery, sortOrderOf };
