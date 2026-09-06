"use strict";

const SystemLog = require("../models/SystemLog");
const { normalizeRole } = require("../services/systemLogService");

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

const getSystemLogs = async (req, res) => {
  try {
    const {
      search = "",
      role = "all",
      action = "all",
      platform = "all",
      fromDate,
      toDate,
      page = 1,
      limit = 25,
      sort = "desc",
    } = req.query;

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

    const dateRange = buildDateRange(fromDate, toDate);

    if (Object.keys(dateRange).length > 0) {
      Object.assign(filters, dateRange);
    }

    const queryString = String(search).trim();

    if (queryString) {
      const escapedSearch = escapeRegex(queryString);
      const regex = new RegExp(escapedSearch, "i");

      filters.$or = [
        { action: regex },
        { role: regex },
        { ipAddress: regex },
        { description: regex },
        { resource: regex },
      ];
    }

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
        .lean(),

      SystemLog.countDocuments(filters),
    ]);

    const totalPages = Math.max(
      1,
      Math.ceil(total / pageLimit)
    );

    return res.status(200).json({
      success: true,
      count: logs.length,
      total,
      page: pageNumber,
      limit: pageLimit,
      totalPages,
      logs,
    });
  } catch (error) {
    console.error("❌ Error in getSystemLogs:", error);

    return res.status(500).json({
      success: false,
      message:
        "Server error while fetching system logs. Please try again later.",
    });
  }
};

module.exports = {
  getSystemLogs,
};