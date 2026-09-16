"use strict";

const User = require("../../models/User");
const SystemLog = require("../../models/SystemLog");
const { DAY_MS } = require("../../utils/dateWindow");

const clampLimit = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
};

const percentChange = (current, baseline) => {
  if (baseline <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - baseline) / baseline) * 100);
};

const loadDashboardData = ({ now, usersLimit, activitiesLimit, monthWindow, dayWindow }) => {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);

  return Promise.all([
    User.countDocuments({}),
    User.countDocuments({ createdAt: { $lt: startOfMonth } }),
    User.countDocuments({ verified: true }),
    User.countDocuments({ verified: true, createdAt: { $lt: startOfMonth } }),
    User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    User.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
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
    User.aggregate([
      { $match: { createdAt: { $gte: monthWindow[0].start } } },
      {
        $group: {
          _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
    ]),
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
};

module.exports = { clampLimit, percentChange, loadDashboardData };
