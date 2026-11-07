"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const { isQueuedService } = require("../../config/consultationCategories");
const { priorityGroupLabel } = require("../../utils/priorityQueue");
const { startOfDay } = require("../../utils/dateWindow");

// Why a queued request has no time yet, from facts the server holds, never an
// estimate. Every freed or added slot re-runs the queue, so a request that is
// still pending with a mission on offer is one that no open time fits.
const WAIT_REASONS = Object.freeze({
  NO_MISSION: "no_mission",
  NO_OPEN_TIME: "no_open_time",
});

const offeredOnUpcomingMissions = async (now) => {
  const missions = await MissionSchedule.find({ date: { $gte: startOfDay(now) } }).select("categories").lean();
  return new Set(missions.flatMap((mission) => (mission.categories || []).map((category) => category.categoryKey)));
};

/**
 * Adds what staff need to read the queue: the priority group's name and, for a
 * queued doctor service, why it is still waiting. Rows are already ranked.
 */
const withQueueDetails = async (rows, now = new Date()) => {
  if (!rows.length) return rows;
  const offered = rows.some((row) => isQueuedService(row.consultationType))
    ? await offeredOnUpcomingMissions(now)
    : new Set();

  return rows.map((row) => ({
    ...row,
    priorityGroupLabel: priorityGroupLabel(row.prioritySortKey),
    queueWaitReason: isQueuedService(row.consultationType)
      ? offered.has(row.consultationType)
        ? WAIT_REASONS.NO_OPEN_TIME
        : WAIT_REASONS.NO_MISSION
      : null,
  }));
};

module.exports = { WAIT_REASONS, withQueueDetails };
