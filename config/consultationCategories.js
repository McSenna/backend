"use strict";

/**
 * Configurable consultation categories with default durations (minutes).
 * Ranges use min/max; fixed categories use durationMinutes only.
 */
const CONSULTATION_CATEGORIES = [
  { key: "immunization", label: "Immunization", durationMinutes: 10 },
  { key: "bp_checking", label: "BP Checking", durationMinutes: 5 },
  { key: "prenatal", label: "Prenatal", durationMinutes: 20 },
  {
    key: "general_checkup",
    label: "General Check-up",
    durationMinutesMin: 15,
    durationMinutesMax: 20,
  },
  {
    key: "consultation",
    label: "Consultation",
    durationMinutesMin: 20,
    durationMinutesMax: 30,
  },
];

const byKey = Object.fromEntries(CONSULTATION_CATEGORIES.map((c) => [c.key, c]));

function getCategory(key) {
  return byKey[key] || null;
}

function resolveDurationMinutes(categoryKey, requestedMinutes) {
  const cat = getCategory(categoryKey);
  if (!cat) return null;
  if (typeof cat.durationMinutes === "number") return cat.durationMinutes;
  const min = cat.durationMinutesMin;
  const max = cat.durationMinutesMax;
  if (requestedMinutes == null) return min;
  const n = Number(requestedMinutes);
  if (Number.isNaN(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function validateDurationForCategory(categoryKey, minutes) {
  const cat = getCategory(categoryKey);
  if (!cat) return { ok: false, message: "Unknown category" };
  const resolved = resolveDurationMinutes(categoryKey, minutes);
  if (resolved == null) return { ok: false, message: "Invalid duration" };
  if (typeof cat.durationMinutes === "number" && resolved !== cat.durationMinutes) {
    return { ok: false, message: `Duration for ${cat.label} must be ${cat.durationMinutes} minutes` };
  }
  return { ok: true, durationMinutes: resolved };
}

module.exports = {
  CONSULTATION_CATEGORIES,
  getCategory,
  resolveDurationMinutes,
  validateDurationForCategory,
};
