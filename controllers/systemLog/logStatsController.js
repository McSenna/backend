"use strict";

const SystemLog = require("../../models/SystemLog");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");

const DAY_MS = 86400000;

const percentChange = (current, previous) => {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

const statWindows = () => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    startOfToday,
    startOfYesterday: new Date(startOfToday.getTime() - DAY_MS),
    startOfWeek: new Date(startOfToday.getTime() - 6 * DAY_MS),
    startOfPrevWeek: new Date(startOfToday.getTime() - 13 * DAY_MS),
    startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    startOfPrevMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1),
  };
};

const metric = (value, current, previous, { comparisonLabel, lowerIsBetter = false }) => ({
  value,
  change: percentChange(current, previous),
  direction: lowerIsBetter
    ? current <= previous
      ? "down"
      : "up"
    : current >= previous
      ? "up"
      : "down",
  comparisonLabel,
});

exports.getSystemLogStats = asyncHandler(async (req, res) => {
  const {
    startOfToday,
    startOfYesterday,
    startOfWeek,
    startOfPrevWeek,
    startOfMonth,
    startOfPrevMonth,
  } = statWindows();

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
    SystemLog.countDocuments({
      severity: "error",
      createdAt: { $gte: startOfYesterday, $lt: startOfToday },
    }),
    SystemLog.countDocuments({ severity: "warning", createdAt: { $gte: startOfWeek } }),
    SystemLog.countDocuments({
      severity: "warning",
      createdAt: { $gte: startOfPrevWeek, $lt: startOfWeek },
    }),
    SystemLog.countDocuments({ success: true, createdAt: { $gte: startOfMonth } }),
    SystemLog.countDocuments({
      success: true,
      createdAt: { $gte: startOfPrevMonth, $lt: startOfMonth },
    }),
  ]);

  const successfulActions = await SystemLog.countDocuments({ success: true });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    stats: {
      totalLogs: metric(totalLogs, totalLogsThisMonth, totalLogsPrevMonth, {
        comparisonLabel: "vs. last month",
      }),
      errorsToday: metric(errorsToday, errorsToday, errorsYesterday, {
        comparisonLabel: "vs. yesterday",
        lowerIsBetter: true,
      }),
      warnings: metric(warningsThisWeek, warningsThisWeek, warningsPrevWeek, {
        comparisonLabel: "vs. last week",
        lowerIsBetter: true,
      }),
      successfulActions: metric(successfulActions, successThisMonth, successPrevMonth, {
        comparisonLabel: "vs. last month",
      }),
    },
  });
});
