"use strict";

const Appointment = require("../../models/Appointment");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const DUPLICATE_KEY = 11000;

/** The booking an earlier try with the same request key already made, if any. */
const findEarlierBooking = (residentId, requestKey, session = null) =>
  requestKey
    ? Appointment.findOne({ resident: residentId, bookingRequestKey: requestKey }).session(session)
    : null;

/**
 * The unique indexes are the last line of defence behind the day and mission
 * locks. A repeated request key answers with the first booking; a slot the
 * index refused is reported as taken, never as a server error.
 */
const recoverFromDuplicateKey = async (error, { residentId, requestKey }) => {
  if (error?.code !== DUPLICATE_KEY) throw error;
  if (error.keyPattern?.immunizationSlotKey) {
    throw conflict("That time was just taken. Please try again.", ERROR_CODES.SLOT_UNAVAILABLE);
  }
  if (!requestKey || !error.keyPattern?.bookingRequestKey) throw error;

  const existing = await findEarlierBooking(residentId, requestKey);
  if (!existing) throw error;
  return { appointment: existing, replayed: true };
};

module.exports = { findEarlierBooking, recoverFromDuplicateKey };
