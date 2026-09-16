"use strict";

const MissionSchedule = require("../../models/MissionSchedule");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");

const DEFAULT_WINDOWS = {
  morningStart: "08:00",
  morningEnd: "12:00",
  afternoonStart: "13:00",
  afternoonEnd: "17:00",
};

const assertDateIsFree = async (day, excludeId = null) => {
  const filter = { date: day };
  if (excludeId) filter._id = { $ne: excludeId };

  const duplicate = await MissionSchedule.findOne(filter).lean();
  if (duplicate) {
    throw conflict(
      "A mission schedule already exists for this date.",
      ERROR_CODES.DUPLICATE_SCHEDULE
    );
  }
};

const logScheduleChange = ({ req, action, description, resourceId, metadata }) =>
  createSystemLog({
    req,
    action,
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description,
    resource: "MissionSchedule",
    resourceId,
    metadata,
  });

module.exports = { DEFAULT_WINDOWS, assertDateIsFree, logScheduleChange };
