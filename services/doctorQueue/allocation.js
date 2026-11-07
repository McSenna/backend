"use strict";

const Appointment = require("../../models/Appointment");
const logger = require("../../utils/logger");
const { processUpcomingMissionSchedulesPriorityQueue } = require("../triageQueue");
const { announceReturnedToQueue } = require("./notifications");

/**
 * Runs the priority queue over every upcoming mission. A failure leaves the
 * requests pending, where the next run (another request, a mission edit, a
 * freed slot) picks them up, so it is logged instead of failing the caller.
 */
const allocateQueuedRequests = async ({ staffId = null, route }) => {
  try {
    return await processUpcomingMissionSchedulesPriorityQueue({ staffId });
  } catch (error) {
    logger.warn("Queue allocation failed; requests stay queued", {
      route,
      errorName: error?.name,
      errorMessage: error?.message,
    });
    return { totalAssigned: 0, failed: true };
  }
};

/**
 * After a mission edit or removal and the re-run that follows it: tells each
 * resident whose visit was released and is still waiting. Those the re-run
 * placed again get the usual confirmation from the queue instead.
 */
const notifyStillQueued = async (released) => {
  if (!released?.length) return;
  const waiting = await Appointment.find({ _id: { $in: released.map((row) => row._id) }, status: "pending" })
    .select("_id")
    .lean();
  const waitingIds = new Set(waiting.map((row) => String(row._id)));
  for (const row of released) {
    if (waitingIds.has(String(row._id))) await announceReturnedToQueue(row);
  }
};

module.exports = { allocateQueuedRequests, notifyStillQueued };
