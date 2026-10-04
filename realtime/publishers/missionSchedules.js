"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const { broadcast } = require("../broadcast");
const { roleRoom } = require("../rooms");
const { splitChanges } = require("./shared");

// GET /mission-schedule is open to these roles (appointmentRoutes RESIDENT_OR_STAFF);
// BHWs do not read missions, so they get no mission events.
const MISSION_READERS = ["resident", "doctor", "admin", "midwife"].map(roleRoom);

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    // The list endpoint returns the stored document as is.
    const missions = await MissionSchedule.find({ _id: { $in: liveIds } }).lean();
    for (const mission of missions) {
      broadcast("missionSchedule", actionOf(mission._id), mission, MISSION_READERS);
    }
  }

  for (const id of deletedIds) {
    broadcast("missionSchedule", "deleted", { id }, MISSION_READERS);
  }
};

module.exports = { name: "missionSchedules", model: MissionSchedule, publish };
