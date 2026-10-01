"use strict";

const mongoose = require("mongoose");
const BookingLock = require("../../models/BookingLock");

const DUPLICATE_KEY = 11000;

// Created outside the transaction: two first bookings of a day may both try to
// insert it, and the loser only needs the winner's document to exist.
const ensureLock = async (key) => {
  try {
    await BookingLock.updateOne({ key }, { $setOnInsert: { key } }, { upsert: true });
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY) throw error;
  }
};

/**
 * Runs `work(session)` in a transaction that first bumps the lock for `key`.
 * Concurrent bookings of the same day write-conflict there, and MongoDB retries
 * the loser against what the winner committed, so a position is never handed
 * out twice. Same pattern as withMissionSlotLock (slotLock.js).
 */
const withBookingDayLock = async (key, work) => {
  await ensureLock(key);
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      await BookingLock.updateOne({ key }, { $inc: { version: 1 } }, { session });
      result = await work(session);
    });
  } finally {
    await session.endSession();
  }

  return result;
};

module.exports = { withBookingDayLock };
