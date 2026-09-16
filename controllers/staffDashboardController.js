"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { DAY_MS, buildDayWindow, todayBounds } = require("../utils/dateWindow");
const { can } = require("../config/inventoryPermissions");
const { resolveQueueScope } = require("../services/queueScope");
const {
  TREND_DAYS,
  ROLE_INVENTORY_CATEGORIES,
  scopeFilter,
  serviceScopeFilter,
} = require("../services/staffDashboard/dashboardConstants");
const {
  summaryFacets,
  todayQueue,
  upcomingQueue,
  recentRecords,
  completionTrend,
  inventoryWatchlist,
} = require("../services/staffDashboard/dashboardQueries");
const {
  toDashboardAppointment,
  toRecentActivity,
  toInventoryAlert,
  visibleServices,
} = require("../services/staffDashboard/dashboardPresenter");
const {
  buildTrend,
  buildServiceBreakdown,
} = require("../services/staffDashboard/trendBuilder");

const countOf = (rows) => rows?.[0]?.n ?? 0;

const getStaffDashboard = asyncHandler(async (req, res) => {
  const { scopeRole, categoryKeys } = resolveQueueScope(req);

  const match = scopeFilter(categoryKeys);
  const recordMatch = serviceScopeFilter(categoryKeys);
  const { start, end } = todayBounds();
  const dayWindow = buildDayWindow(TREND_DAYS);
  const trendStart = dayWindow[0].start;
  const breakdownStart = new Date(start.getTime() - 30 * DAY_MS);

  const inventoryCategories = ROLE_INVENTORY_CATEGORIES[scopeRole] ?? [];
  const showInventory = inventoryCategories.length > 0 && can(scopeRole, "view");

  const [facets, queueRows, upcomingRows, records, trendBuckets, inventoryAlerts] =
    await Promise.all([
      summaryFacets(match, { start, end, breakdownStart }),
      todayQueue(match, { start, end }),
      upcomingQueue(match, { end }),
      recentRecords(recordMatch),
      completionTrend(match, trendStart),
      showInventory ? inventoryWatchlist(inventoryCategories) : Promise.resolve([]),
    ]);

  const facet = facets?.[0] ?? {};
  const services = visibleServices(categoryKeys);

  return res.json({
    success: true,
    message: "Dashboard loaded successfully.",
    role: scopeRole,
    services,
    summary: {
      today: countOf(facet.today),
      waiting: countOf(facet.waiting),
      processing: countOf(facet.processing),
      completedToday: countOf(facet.completedToday),
      upcoming: countOf(facet.upcoming),
      pending: countOf(facet.pending),
      totalPatients: countOf(facet.patients),
    },
    serviceBreakdown: buildServiceBreakdown(services, facet),
    trend: buildTrend(dayWindow, trendBuckets, services),
    queue: queueRows.map(toDashboardAppointment),
    upcoming: upcomingRows.map(toDashboardAppointment),
    recentActivity: records.map(toRecentActivity),
    inventoryAlerts: inventoryAlerts.map(toInventoryAlert),
    generatedAt: new Date().toISOString(),
  });
});

module.exports = { getStaffDashboard, TREND_DAYS, ROLE_INVENTORY_CATEGORIES };
