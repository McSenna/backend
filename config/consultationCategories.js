"use strict";

const CONSULTATION_CATEGORIES = [
  {
    key: "general_checkup",
    label: "General Checkup",
    order: 1,
    description: "General health assessment and routine checkup.",
    durationMinutesMin: 15,
    durationMinutesMax: 20,
    residentBookable: true,
    queueRole: "doctor",
  },
  {
    key: "prenatal",
    label: "Prenatal",
    order: 2,
    description: "Maternal health check for expecting mothers.",
    durationMinutes: 20,
    residentBookable: true,
    queueRole: "midwife",
  },
  {
    key: "immunization",
    label: "Immunization",
    order: 3,
    description: "Scheduled vaccination and immunization services.",
    durationMinutes: 10,
    residentBookable: true,
    queueRole: "midwife",
  },
  {
    key: "consultation",
    label: "Consultation",
    order: 4,
    description: "Talk to a health worker about a specific concern.",
    durationMinutesMin: 20,
    durationMinutesMax: 30,
    residentBookable: true,
    queueRole: "doctor",
  },
  {
    key: "bp_checking",
    label: "BP Checking",
    order: 5,
    description: "Blood pressure reading and monitoring.",
    durationMinutes: 5,
    residentBookable: true,
    queueRole: "bhw",
  },
];

const DEFAULT_QUEUE_ROLE = "doctor";
const DEFAULT_PROVIDER_ROLES = Object.freeze([DEFAULT_QUEUE_ROLE]);

const QUEUE_ROLES = Object.freeze(["doctor", "midwife", "bhw"]);

const MISSION_MANAGER_ROLES = Object.freeze(["doctor", "admin"]);

function canCreateMission(role) {
  return MISSION_MANAGER_ROLES.includes(normalizeRole(role));
}

const byKey = Object.fromEntries(CONSULTATION_CATEGORIES.map((c) => [c.key, c]));

const SERVICE_QUEUE_MAPPING = Object.freeze(
  Object.fromEntries(CONSULTATION_CATEGORIES.map((c) => [c.key, c.queueRole || DEFAULT_QUEUE_ROLE]))
);

function normalizeRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function getCategory(key) {
  return byKey[key] || null;
}

function getQueueRole(key) {
  const cat = getCategory(key);
  return cat?.queueRole || DEFAULT_QUEUE_ROLE;
}

function getCategoryKeysForRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === "admin") return CONSULTATION_CATEGORIES.map((c) => c.key);
  return CONSULTATION_CATEGORIES.filter(
    (c) => (c.queueRole || DEFAULT_QUEUE_ROLE) === normalized
  ).map((c) => c.key);
}

function getResidentBookableCategories() {
  return CONSULTATION_CATEGORIES.filter((c) => c.residentBookable !== false).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
}

function getEligibleProviderRoles(key) {
  const cat = getCategory(key);
  if (!cat) return [];
  return [cat.queueRole || DEFAULT_QUEUE_ROLE];
}

function isProviderRoleAllowed(key, role) {
  return getEligibleProviderRoles(key).includes(normalizeRole(role));
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
  DEFAULT_PROVIDER_ROLES,
  DEFAULT_QUEUE_ROLE,
  QUEUE_ROLES,
  MISSION_MANAGER_ROLES,
  SERVICE_QUEUE_MAPPING,
  canCreateMission,
  getCategory,
  getQueueRole,
  getCategoryKeysForRole,
  getResidentBookableCategories,
  getEligibleProviderRoles,
  isProviderRoleAllowed,
  resolveDurationMinutes,
  validateDurationForCategory,
};
