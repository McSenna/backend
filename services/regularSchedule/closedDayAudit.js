"use strict";

const { getCategory } = require("../../config/consultationCategories");
const { QUEUE_ACTIVE_STATUSES } = require("../../models/Appointment");

/**
 * Visits of a service whose slot falls on a weekday the service no longer runs
 * (prenatal on a Thursday, booked on a mission before 2026-11-07). Read-only: a
 * listed visit stays valid until staff move or close it the usual way.
 */
const visitsOnClosedDays = (categoryKey, rows) => {
  const weekdays = getCategory(categoryKey)?.serviceWeekdays ?? [];
  return rows
    .filter((row) => row.slotStart && !weekdays.includes(new Date(row.slotStart).getDay()))
    .map((row) => ({
      id: String(row._id),
      status: row.status,
      slotStart: new Date(row.slotStart).toISOString(),
      weekday: new Date(row.slotStart).getDay(),
      active: QUEUE_ACTIVE_STATUSES.includes(row.status),
      onMission: Boolean(row.missionSchedule),
    }));
};

module.exports = { visitsOnClosedDays };
