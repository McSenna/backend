"use strict";

const User = require("../models/User");
const SystemLog = require("../models/SystemLog");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");

/**
 * Fixed presentation order for the role donut. Roles are listed even when their
 * count is zero so the legend never changes shape between refreshes.
 */
const ROLE_ORDER = ["admin", "doctor", "midwife", "bhw", "resident"];

const ROLE_LABELS = {
  admin: "Admin",
  doctor: "Doctor",
  midwife: "Midwife",
  bhw: "BHW",
  resident: "Resident",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clamps a client-supplied list size so one request cannot pull the collection. */
function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

/**
 * Growth against a baseline taken at the start of the current month.
 *
 * A zero baseline has no meaningful percentage: report +100% when the metric
 * grew from nothing and 0% when it is still empty, rather than Infinity/NaN.
 */
function percentChange(current, baseline) {
  if (baseline <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - baseline) / baseline) * 100);
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Months the registration trend covers, including the current one. */
const TREND_MONTHS = 6;
/** Days the activity trend covers, including today. */
const TREND_DAYS = 7;

/**
 * Turns `{ _id: { y, m, d }, count }` aggregation output into a dense series.
 *
 * Buckets with no documents are absent from the aggregation, but a chart with
 * gaps silently misreads as "no data yet" instead of "nothing happened that
 * day", so every bucket in the window is emitted with an explicit zero.
 */
function buildDenseSeries(buckets, window) {
  const counts = new Map(buckets.map((b) => [b.key, b.count]));
  return window.map((slot) => ({
    key: slot.key,
    label: slot.label,
    count: counts.get(slot.key) || 0,
  }));
}

function buildMonthWindow(now) {
  const slots = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    slots.push({
      key: `${date.getFullYear()}-${date.getMonth() + 1}`,
      label: MONTH_LABELS[date.getMonth()],
      start: date,
    });
  }
  return slots;
}

function buildDayWindow(now) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const slots = [];
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const date = new Date(startOfToday.getTime() - i * DAY_MS);
    slots.push({
      key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      label: WEEKDAY_LABELS[date.getDay()],
      start: date,
    });
  }
  return slots;
}

/**
 * Aggregated payload for the Admin dashboard.
 *
 * One endpoint rather than five so the dashboard costs a single round trip on
 * mobile, and so the metric cards, the donut and both lists always describe the
 * same instant.
 *
 * Query params:
 *   usersLimit      — recent users to return (default 5, max 20)
 *   activitiesLimit — recent activities to return (default 5, max 20)
 */
const getAdminDashboard = asyncHandler(async (req, res) => {
  const usersLimit = clampLimit(req.query.usersLimit, 5, 20);
  const activitiesLimit = clampLimit(req.query.activitiesLimit, 5, 20);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);

  // Trend windows are built first so the aggregations can be bounded by the
  // same start date the response will render.
  const monthWindow = buildMonthWindow(now);
  const dayWindow = buildDayWindow(now);

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
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ createdAt: { $lt: startOfMonth } }),

    // "Active" is an account the system will actually let in: a verified one.
    User.countDocuments({ verified: true }),
    User.countDocuments({ verified: true, createdAt: { $lt: startOfMonth } }),

    User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    User.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),

    // Residents are the people the barangay health centre treats; staff roles
    // are operators of the system, not patients.
    User.countDocuments({ role: "resident" }),
    User.countDocuments({ role: "resident", createdAt: { $lt: startOfMonth } }),

    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),

    User.find({})
      .select("fullname email profilePhoto role verified createdAt")
      .sort({ createdAt: -1 })
      .limit(usersLimit)
      .lean(),

    SystemLog.find({})
      .sort({ createdAt: -1 })
      .limit(activitiesLimit)
      .populate({ path: "userId", select: "fullname role" })
      .lean(),

    // Registrations per month over the trend window. Grouped on date parts
    // rather than a formatted string so the server's local calendar decides
    // month boundaries, matching the metric baselines above.
    User.aggregate([
      { $match: { createdAt: { $gte: monthWindow[0].start } } },
      {
        $group: {
          _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
    ]),

    // System activity per day over the last week.
    SystemLog.aggregate([
      { $match: { createdAt: { $gte: dayWindow[0].start } } },
      {
        $group: {
          _id: {
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
            d: { $dayOfMonth: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const countsByRole = new Map(
    roleCounts.map((entry) => [String(entry._id || "unknown"), entry.count])
  );

  const roleDistribution = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    count: countsByRole.get(role) || 0,
  }));

  const registrationTrend = buildDenseSeries(
    registrationBuckets.map((b) => ({ key: `${b._id.y}-${b._id.m}`, count: b.count })),
    monthWindow
  );

  const activityTrend = buildDenseSeries(
    activityBuckets.map((b) => ({ key: `${b._id.y}-${b._id.m}-${b._id.d}`, count: b.count })),
    dayWindow
  );

  const recentActivities = recentLogs.map((log) => ({
    _id: String(log._id),
    action: log.action,
    // The populated account is the source of truth for the actor's name; a log
    // whose user was deleted still has to render, so fall back to the role.
    actorName: log.userId?.fullname || "",
    role: log.userId?.role || log.role || "unknown",
    description: log.description || "",
    resource: log.resource || "",
    platform: log.platform || "",
    success: log.success !== false,
    createdAt: log.createdAt,
  }));

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
    roleDistribution,
    registrationTrend,
    activityTrend,
    recentUsers: recentUsers.map((user) => ({
      _id: String(user._id),
      fullname: user.fullname,
      email: user.email,
      profilePhoto: user.profilePhoto || "",
      role: user.role,
      verified: Boolean(user.verified),
      createdAt: user.createdAt,
    })),
    recentActivities,
    generatedAt: now.toISOString(),
  });
});

module.exports = { getAdminDashboard };
