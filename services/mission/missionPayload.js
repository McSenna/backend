"use strict";

const { getCategory, resolveDurationMinutes } = require("../../config/consultationCategories");
const { parseHHMM } = require("../../utils/slotAvailability");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const normalizeDateInput = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const resolveDayWindows = ({ morning, afternoon, startTime, endTime }, fallback) => {
  const bothTimesGiven = startTime != null && endTime != null;

  const morningStart = startTime != null ? String(startTime) : morning?.start || fallback.morningStart;
  const morningEnd = endTime != null ? String(endTime) : morning?.end || fallback.morningEnd;
  const afternoonStart = bothTimesGiven ? String(endTime) : afternoon?.start || fallback.afternoonStart;
  const afternoonEnd = bothTimesGiven ? String(endTime) : afternoon?.end || fallback.afternoonEnd;

  const minutes = [morningStart, morningEnd, afternoonStart, afternoonEnd].map(parseHHMM);
  if (minutes.some((value) => value == null)) {
    throw badRequest("Please enter times in HH:mm format.", ERROR_CODES.VALIDATION_ERROR);
  }

  const [mStart, mEnd, aStart, aEnd] = minutes;
  // An empty window (start === end) is how a single-window mission is stored,
  // but a reversed one is a typo that used to be dropped without a word.
  if (mEnd < mStart || aEnd < aStart || (!(mEnd > mStart) && !(aEnd > aStart))) {
    throw badRequest("The end time must be after the start time.", ERROR_CODES.VALIDATION_ERROR);
  }
  // Overlapping windows made the slot generator list the shared times twice.
  if (mEnd > mStart && aEnd > aStart && mStart < aEnd && aStart < mEnd) {
    throw badRequest(
      "The morning and afternoon hours must not overlap.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  return { morningStart, morningEnd, afternoonStart, afternoonEnd };
};

const normalizeCategories = (categories) => {
  const list = Array.isArray(categories) ? categories : [];
  const normalized = [];

  for (const entry of list) {
    const key = entry.categoryKey || entry.key;
    if (!key) {
      throw badRequest(
        "Every consultation category must be identified.",
        ERROR_CODES.VALIDATION_ERROR
      );
    }
    if (!getCategory(key)) {
      throw badRequest(
        `"${key}" is not a recognised consultation category.`,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
    const durationMinutes = resolveDurationMinutes(key, entry.durationMinutes);
    if (durationMinutes == null) {
      throw badRequest(
        `The duration set for "${key}" is not allowed for that category.`,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
    normalized.push({ categoryKey: key, durationMinutes });
  }

  if (!normalized.length) {
    throw badRequest(
      "Add at least one consultation category with a duration so slots can be generated.",
      ERROR_CODES.MISSING_FIELDS
    );
  }

  return normalized;
};

module.exports = { normalizeDateInput, resolveDayWindows, normalizeCategories };
