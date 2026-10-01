"use strict";

const mongoose = require("mongoose");
const MissionSchedule = require("../../models/MissionSchedule");

/**
 * Runs `work(session)` in a transaction that first writes to the mission
 * document. Two bookings on the same mission day then write-conflict: MongoDB
 * aborts one, and `withTransaction` retries it against the committed slots, so
 * a slot that was just taken is seen as taken instead of being booked twice.
 *
 * Every path that puts an appointment into a slot goes through here: resident
 * reschedule, staff assign and reassign, and the triage auto-confirm.
 */
const withMissionSlotLock = async (missionId, work) => {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      await MissionSchedule.updateOne(
        { _id: missionId },
        { $inc: { bookingVersion: 1 } },
        { session, timestamps: false }
      );
      result = await work(session);
    });
  } finally {
    await session.endSession();
  }

  return result;
};

module.exports = { withMissionSlotLock };
