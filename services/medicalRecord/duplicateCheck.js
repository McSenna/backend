"use strict";

// A possible duplicate is a record for the same person and service on the same
// calendar day, whether it was encoded from paper or completed through an
// appointment on the linked account. Two real visits on one day can happen, so
// this only warns; staff may confirm and save anyway.

const MedicalRecord = require("../../models/MedicalRecord");
const User = require("../../models/User");
const AppError = require("../../utils/AppError");
const { HTTP_STATUS, ERROR_CODES } = require("../../utils/errorCodes");
const { utcDayRange } = require("../../utils/calendarDate");

const MAX_REPORTED = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const findPossibleDuplicates = async ({ masterResidentId, serviceType, visitDate, excludeId = null }) => {
  const { start, end } = utcDayRange(visitDate);
  const account = await User.findOne({ masterResidentId }).select("_id").lean();

  // Appointment times are local (Manila, UTC+8), so their calendar day may
  // straddle two UTC days; widen the window by a day on each side for them.
  const owners = [{ masterResidentId, completedAt: { $gte: start, $lt: end } }];
  if (account) {
    owners.push({
      resident: account._id,
      completedAt: { $gte: new Date(start.getTime() - DAY_MS), $lt: new Date(end.getTime() + DAY_MS) },
    });
  }

  const matches = await MedicalRecord.find({
    serviceType,
    $or: owners,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("_id")
    .sort({ completedAt: -1 })
    .limit(MAX_REPORTED)
    .lean();

  return matches.map((record) => String(record._id));
};

const possibleDuplicateError = (existingRecordIds) =>
  new AppError(
    "This medical record may already exist. Review the existing record before continuing.",
    HTTP_STATUS.CONFLICT,
    ERROR_CODES.POSSIBLE_DUPLICATE,
    { existingRecordIds }
  );

module.exports = { findPossibleDuplicates, possibleDuplicateError };
