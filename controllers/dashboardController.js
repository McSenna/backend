"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");
const { buildDayWindow, buildDenseSeries, buildMonthWindow } = require("../utils/dateWindow");
const {
  clampLimit,
  percentChange,
  loadDashboardData,
} = require("../services/adminDashboard/adminMetrics");
const {
  buildRoleDistribution,
  toRecentActivity,
  toRecentUser,
  monthlyKey,
  dailyKey,
} = require("../services/adminDashboard/adminPresenter");

const TREND_MONTHS = 6;
const TREND_DAYS = 60;

const getAdminDashboard = asyncHandler(async (req, res) => {
  const usersLimit = clampLimit(req.query.usersLimit, 5, 20);
  const activitiesLimit = clampLimit(req.query.activitiesLimit, 5, 20);

  const now = new Date();
  const monthWindow = buildMonthWindow(TREND_MONTHS, now);
  const dayWindow = buildDayWindow(TREND_DAYS, now);

  const [
    totalUsers,
    totalUsersBaseline,
    activeUsers,
    activeUsersBaseline,
    newUsersLast30Days,
    newUsersPrevious30Days,
    totalPatients,
    totalPatientsBaseline,
    roleCounts,
    recentUsers,
    recentLogs,
    registrationBuckets,
    activityBuckets,
  ] = await loadDashboardData({ now, usersLimit, activitiesLimit, monthWindow, dayWindow });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Dashboard loaded successfully.",
    metrics: {
      totalUsers,
      totalUsersGrowth: percentChange(totalUsers, totalUsersBaseline),
      activeUsers,
      activeUsersGrowth: percentChange(activeUsers, activeUsersBaseline),
      newUsersLast30Days,
      newUsersGrowth: percentChange(newUsersLast30Days, newUsersPrevious30Days),
      totalPatients,
      totalPatientsGrowth: percentChange(totalPatients, totalPatientsBaseline),
    },
    roleDistribution: buildRoleDistribution(roleCounts),
    registrationTrend: buildDenseSeries(registrationBuckets.map(monthlyKey), monthWindow),
    activityTrend: buildDenseSeries(activityBuckets.map(dailyKey), dayWindow),
    recentUsers: recentUsers.map(toRecentUser),
    recentActivities: recentLogs.map(toRecentActivity),
    generatedAt: now.toISOString(),
  });
});

module.exports = { getAdminDashboard };
