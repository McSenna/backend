"use strict";

const Appointment = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const InventoryItem = require("../../models/InventoryItem");
const { DAY_MS } = require("../../utils/dateWindow");
const {
  WAITING_STATUSES,
  ACTIVE_STATUSES,
  SLOT_OCCUPYING_STATUSES,
} = require("./dashboardConstants");

const QUEUE_SELECT = "consultationType status slotStart slotEnd resident isUrgent";

const summaryFacets = (match, { start, end, breakdownStart }) => {
  const todayScheduled = {
    status: { $in: SLOT_OCCUPYING_STATUSES },
    slotStart: { $gte: start, $lt: end },
  };

  return Appointment.aggregate([
    { $match: match },
    {
      $facet: {
        today: [{ $match: todayScheduled }, { $count: "n" }],
        waiting: [
          { $match: { status: { $in: WAITING_STATUSES }, slotStart: { $gte: start, $lt: end } } },
          { $count: "n" },
        ],
        processing: [{ $match: { status: "processing" } }, { $count: "n" }],
        completedToday: [
          { $match: { status: "completed", completedAt: { $gte: start, $lt: end } } },
          { $count: "n" },
        ],
        upcoming: [
          { $match: { status: { $in: WAITING_STATUSES }, slotStart: { $gte: end } } },
          { $count: "n" },
        ],
        pending: [{ $match: { status: "pending" } }, { $count: "n" }],
        todayByService: [
          { $match: todayScheduled },
          { $group: { _id: "$consultationType", count: { $sum: 1 } } },
        ],
        completedByService: [
          { $match: { status: "completed", completedAt: { $gte: breakdownStart } } },
          { $group: { _id: "$consultationType", count: { $sum: 1 } } },
        ],
        patients: [
          { $match: { status: "completed" } },
          { $group: { _id: "$resident" } },
          { $count: "n" },
        ],
      },
    },
  ]);
};

const todayQueue = (match, { start, end }) =>
  Appointment.find({ ...match, status: { $in: ACTIVE_STATUSES }, slotStart: { $gte: start, $lt: end } })
    .sort({ slotStart: 1 })
    .limit(20)
    .populate("resident", "fullname")
    .select(QUEUE_SELECT)
    .lean();

const upcomingQueue = (match, { end }) =>
  Appointment.find({ ...match, status: { $in: WAITING_STATUSES }, slotStart: { $gte: end } })
    .sort({ slotStart: 1 })
    .limit(10)
    .populate("resident", "fullname")
    .select(QUEUE_SELECT)
    .lean();

const recentRecords = (recordMatch) =>
  MedicalRecord.find(recordMatch)
    .sort({ completedAt: -1 })
    .limit(8)
    .populate("resident", "fullname")
    .populate("provider", "fullname")
    .select("serviceType serviceDetails completedAt resident provider appointment itemsGiven")
    .lean();

const completionTrend = (match, trendStart) =>
  Appointment.aggregate([
    { $match: { ...match, status: "completed", completedAt: { $gte: trendStart } } },
    {
      $group: {
        _id: {
          y: { $year: "$completedAt" },
          m: { $month: "$completedAt" },
          d: { $dayOfMonth: "$completedAt" },
          service: "$consultationType",
        },
        count: { $sum: 1 },
      },
    },
  ]);

const inventoryWatchlist = (categories) =>
  InventoryItem.find({
    isActive: true,
    category: { $in: categories },
    $or: [
      { $expr: { $lte: ["$currentStock", "$reorderLevel"] } },
      { nearestExpiry: { $ne: null, $lt: new Date(Date.now() + 30 * DAY_MS) } },
    ],
  })
    .sort({ currentStock: 1 })
    .limit(6)
    .select("name specification category unit currentStock reorderLevel nearestExpiry")
    .lean();

module.exports = {
  summaryFacets,
  todayQueue,
  upcomingQueue,
  recentRecords,
  completionTrend,
  inventoryWatchlist,
};
