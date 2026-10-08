"use strict";

const { getCategory, isWeeklyService } = require("../../config/consultationCategories");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

/**
 * Medical missions carry the doctor, midwife and BHW services that need a
 * mission day. A weekly service (immunization) has its own schedule, so no
 * mission may list it, list slots for it, or place a visit for it.
 */
const assertMissionService = (categoryKey) => {
  if (!isWeeklyService(categoryKey)) return;
  const label = getCategory(categoryKey)?.label ?? "This service";
  throw badRequest(
    `${label} runs every Thursday on its own schedule and is not booked on medical missions.`,
    ERROR_CODES.VALIDATION_ERROR
  );
};

module.exports = { assertMissionService };
