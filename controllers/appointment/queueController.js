"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const {
  resolveQueueScope,
  applyCategoryFilter,
  withQueueRole,
} = require("../../services/queueScope");
const {
  loadPendingQueue,
  loadAppointments,
} = require("../../services/appointmentQueueService");
const {
  loadQueueOverview,
  loadCategoryAnalytics,
} = require("../../services/appointmentAnalyticsService");

const resolveVisibleKeys = (req) => {
  const { scopeRole, categoryKeys } = resolveQueueScope(req);
  return { scopeRole, visibleKeys: applyCategoryFilter(categoryKeys, req.query?.categoryKey) };
};

exports.getPendingAppointments = asyncHandler(async (req, res) => {
  const { scopeRole, visibleKeys } = resolveVisibleKeys(req);
  const pending = await loadPendingQueue(visibleKeys);

  return res.json({
    success: true,
    message: "Pending queue loaded successfully.",
    queueRole: scopeRole,
    appointments: pending.map(withQueueRole),
  });
});

exports.listAppointments = asyncHandler(async (req, res) => {
  const { scopeRole, visibleKeys } = resolveVisibleKeys(req);
  const { status, missionScheduleId } = req.query;

  const list = await loadAppointments({ visibleKeys, status, missionScheduleId });

  return res.json({
    success: true,
    message: "Appointments loaded successfully.",
    queueRole: scopeRole,
    appointments: list.map(withQueueRole),
  });
});

exports.getQueueOverview = asyncHandler(async (req, res) => {
  const { scopeRole, visibleKeys } = resolveVisibleKeys(req);
  const { stats, statusCounts, schedule, breakdown } = await loadQueueOverview(visibleKeys);

  return res.json({
    success: true,
    message: "Overview loaded successfully.",
    queueRole: scopeRole,
    stats,
    statusCounts,
    schedule: schedule.map(withQueueRole),
    breakdown,
  });
});

exports.getAnalyticsByCategory = asyncHandler(async (req, res) => {
  const { visibleKeys } = resolveVisibleKeys(req);
  const analytics = await loadCategoryAnalytics({
    visibleKeys,
    missionScheduleId: req.query.missionScheduleId,
  });

  return res.json({
    success: true,
    message: "Analytics loaded successfully.",
    analytics,
  });
});
