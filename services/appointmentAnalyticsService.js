"use strict";

const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const { CONSULTATION_CATEGORIES } = require("../config/consultationCategories");
const { todayBounds } = require("../utils/dateWindow");
const { BOOKED_STATUSES, SLOT_OCCUPYING_STATUSES, queueFilter } = require("./queueScope");

const overviewFacets = (match, start, end) =>
  Appointment.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        byCategory: [{ $group: { _id: "$consultationType", count: { $sum: 1 } } }],
        today: [
          {
            $match: {
              status: { $in: SLOT_OCCUPYING_STATUSES },
              slotStart: { $gte: start, $lt: end },
            },
          },
          { $count: "n" },
        ],
        upcoming: [
          { $match: { status: { $in: BOOKED_STATUSES }, slotStart: { $gte: end } } },
          { $count: "n" },
        ],
        completedToday: [
          { $match: { status: "completed", completedAt: { $gte: start, $lt: end } } },
          { $count: "n" },
        ],
      },
    },
  ]);

const countsFrom = (rows) => Object.fromEntries((rows ?? []).map((row) => [row._id, row.count]));

const buildBreakdown = (visibleKeys, categoryCounts) =>
  CONSULTATION_CATEGORIES.filter(
    (category) => visibleKeys === null || visibleKeys.includes(category.key)
  ).map((category) => ({
    key: category.key,
    label: category.label,
    count: categoryCounts[category.key] ?? 0,
  }));

const loadQueueOverview = async (visibleKeys) => {
  const match = queueFilter(visibleKeys);
  const { start, end } = todayBounds();

  const [facets] = await overviewFacets(match, start, end);
  const statusCounts = countsFrom(facets?.byStatus);
  const categoryCounts = countsFrom(facets?.byCategory);

  const schedule = await Appointment.find({
    ...match,
    status: { $in: SLOT_OCCUPYING_STATUSES },
    slotStart: { $gte: start, $lt: end },
  })
    .sort({ slotStart: 1 })
    .populate("resident", "fullname profilePhoto")
    .select("consultationType status slotStart slotEnd resident")
    .lean();

  return {
    stats: {
      today: facets?.today?.[0]?.n ?? 0,
      pending: statusCounts.pending ?? 0,
      upcoming: facets?.upcoming?.[0]?.n ?? 0,
      declined: statusCounts.declined ?? 0,
      processing: statusCounts.processing ?? 0,
      completedToday: facets?.completedToday?.[0]?.n ?? 0,
      completed: statusCounts.completed ?? 0,
    },
    statusCounts: {
      pending: statusCounts.pending ?? 0,
      confirmed: statusCounts.confirmed ?? 0,
      rescheduled: statusCounts.rescheduled ?? 0,
      declined: statusCounts.declined ?? 0,
      processing: statusCounts.processing ?? 0,
      completed: statusCounts.completed ?? 0,
    },
    schedule,
    breakdown: buildBreakdown(visibleKeys, categoryCounts),
  };
};

const loadCategoryAnalytics = ({ visibleKeys, missionScheduleId }) => {
  const match = { ...queueFilter(visibleKeys) };
  if (missionScheduleId && mongoose.isValidObjectId(missionScheduleId)) {
    match.missionSchedule = new mongoose.Types.ObjectId(missionScheduleId);
  }

  return Appointment.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          category: { $ifNull: ["$assignedCategoryKey", "$consultationType"] },
          status: "$status",
        },
        count: { $sum: 1 },
      },
    },
  ]);
};

module.exports = { loadQueueOverview, loadCategoryAnalytics };
