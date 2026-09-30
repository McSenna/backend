"use strict";

const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_LIMITS } = require("../../config/announcements");

const DAY_MS = 24 * 60 * 60 * 1000;
// A full ISO-8601 timestamp; bare numbers or loose strings like "tomorrow" are rejected.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const lengthError = (label, value, min, max) => {
  if (!value) return `${label} is required.`;
  if (value.length < min) return `${label} must be at least ${min} characters.`;
  if (value.length > max) return `${label} must not exceed ${max} characters.`;
  return null;
};

// Date() rolls "02-30" over into March, so check the written parts are a real calendar time.
const isRealDateTime = (text) => {
  const [year, month, day, hour, minute] = text.match(/\d+/g).slice(0, 5).map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59;
};

const startOfToday = (now) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
};

/** A Date for a strict ISO timestamp, or null when it is not one. */
const parseIso = (raw) => {
  if (typeof raw !== "string" || !ISO_DATE_TIME.test(raw.trim()) || !isRealDateTime(raw.trim())) {
    return null;
  }
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

const sameInstant = (a, b) => Boolean(a && b && new Date(a).getTime() === new Date(b).getTime());

// Editing an announcement whose event has passed must not force a new date,
// so the range rules only apply to a date the admin actually changed.
const checkEventAt = (raw, now, current) => {
  if (raw === undefined || raw === null || raw === "") {
    return { error: "Choose the date and time of the announcement." };
  }
  const eventAt = parseIso(raw);
  if (!eventAt) return { error: "Enter a valid date and time." };
  if (sameInstant(eventAt, current?.eventAt)) return { value: eventAt };
  if (eventAt < startOfToday(now)) return { error: "The date cannot be in the past." };
  if (eventAt.getTime() - now.getTime() > ANNOUNCEMENT_LIMITS.maxDaysAhead * DAY_MS) {
    return { error: `The date must be within the next ${ANNOUNCEMENT_LIMITS.maxDaysAhead} days.` };
  }
  return { value: eventAt };
};

const checkExpiresAt = (raw, eventAt, now, current) => {
  if (raw === undefined) return { value: current?.expiresAt ?? null };
  if (raw === null || raw === "") return { value: null };
  const expiresAt = parseIso(raw);
  if (!expiresAt) return { error: "Enter a valid end date." };
  if (sameInstant(expiresAt, current?.expiresAt)) return { value: expiresAt };
  if (expiresAt <= now) return { error: "The end date must be in the future." };
  if (eventAt && expiresAt < eventAt) return { error: "The end date cannot be before the event." };
  return { value: expiresAt };
};

const checkAudience = (raw, current) => {
  const audience = raw === undefined || raw === "" ? current?.audience ?? "Everyone" : raw;
  return ANNOUNCEMENT_AUDIENCES.includes(audience)
    ? { value: audience }
    : { error: "Choose who should see this announcement." };
};

const checkIsDraft = (raw, current) => {
  if (raw === undefined) return { value: current?.isDraft ?? false };
  if (typeof raw !== "boolean") return { error: "Choose whether to post now or save a draft." };
  // Its alerts are already in people's inboxes, so hiding it again would leave them dangling.
  if (current && !current.isDraft && raw) {
    return { error: "A posted announcement cannot be moved back to drafts." };
  }
  return { value: raw };
};

/**
 * Validates every field at once so the form can mark all problems together.
 * `current` is the stored row when editing; omitted fields keep its values.
 */
const validateAnnouncementInput = (input, { now = new Date(), current = null } = {}) => {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const L = ANNOUNCEMENT_LIMITS;

  const values = {
    title: asText(body.title),
    message: asText(body.message),
    location: asText(body.location),
  };

  const eventAt = checkEventAt(body.eventAt, now, current);
  const checks = {
    title: { error: lengthError("Title", values.title, L.titleMin, L.titleMax) },
    message: { error: lengthError("Message", values.message, L.messageMin, L.messageMax) },
    eventAt,
    location: { error: lengthError("Location", values.location, L.locationMin, L.locationMax) },
    audience: checkAudience(body.audience, current),
    expiresAt: checkExpiresAt(body.expiresAt, eventAt.value, now, current),
    isDraft: checkIsDraft(body.isDraft, current),
  };

  const fieldErrors = {};
  for (const [field, check] of Object.entries(checks)) {
    if (check.error) fieldErrors[field] = check.error;
  }

  const [firstError] = Object.values(fieldErrors);
  if (firstError) {
    throw badRequest(firstError, ERROR_CODES.VALIDATION_ERROR, { fieldErrors });
  }

  return {
    ...values,
    eventAt: eventAt.value,
    audience: checks.audience.value,
    expiresAt: checks.expiresAt.value,
    isDraft: checks.isDraft.value,
  };
};

module.exports = { validateAnnouncementInput };
