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
    // Residents ask for a visit; the queue places it on a doctor's medical
    // mission (services/doctorQueue). The mission sets the length within the range.
    scheduling: "queue",
  },
  {
    key: "prenatal",
    label: "Prenatal",
    order: 2,
    description: "Maternal health check for expecting mothers.",
    durationMinutes: 20,
    residentBookable: true,
    queueRole: "midwife",
    // Runs on the health center's regular hours, never on a medical mission
    // (2026-11-07). The resident picks the date and time, as for BP checking.
    scheduling: "weekly",
    residentPicksTime: true,
    // Date#getDay() numbering: Monday to Saturday except Thursday, when the
    // midwife runs immunization. Sunday is closed.
    serviceWeekdays: [1, 2, 3, 5, 6],
    closedWeekdayReasons: {
      4: "Prenatal appointments are unavailable on Thursdays because the midwife is assigned to immunization services. Please choose another available day.",
    },
    // The health center hours BP checking uses, as kape chose on 2026-11-07.
    // 20-minute visits: 08:00 to 11:40, then 13:00 to 15:40; Saturday mornings only.
    serviceWindows: [
      { start: "08:00", end: "12:00" },
      { start: "13:00", end: "16:00" },
    ],
    serviceWindowsByWeekday: { 6: [{ start: "08:00", end: "12:00" }] },
  },
  {
    key: "immunization",
    label: "Immunization",
    order: 3,
    description: "Scheduled vaccination and immunization services.",
    durationMinutes: 10,
    residentBookable: false,
    queueRole: "midwife",
    // Date#getDay() numbering: the health center's immunization day is Thursday.
    serviceWeekdays: [4],
    // A resident's reschedule takes the day's first open slot and queues first.
    rescheduleToFirstSlot: true,
    // Runs on its own weekly schedule, never on a doctor's medical mission. Each
    // listed weekday has positions of `durationMinutes` from the window start,
    // and the server hands them out first come, first served.
    scheduling: "weekly",
    // Mornings only, as the health office decided on 2026-10-01.
    serviceWindows: [{ start: "08:00", end: "12:00" }],
    bookingHorizonWeeks: 8,
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
    scheduling: "queue",
  },
  {
    key: "bp_checking",
    label: "BP Checking",
    order: 5,
    description: "Blood pressure reading and monitoring.",
    // Each appointment holds one 10-minute slot.
    durationMinutes: 10,
    residentBookable: true,
    queueRole: "bhw",
    // Runs on its own regular schedule, never on a medical mission (2026-11-06).
    scheduling: "weekly",
    // The resident picks the date and the start time. Immunization's is assigned.
    residentPicksTime: true,
    // Date#getDay() numbering: Monday to Saturday. Sunday is closed.
    serviceWeekdays: [1, 2, 3, 4, 5, 6],
    // Starts run every `durationMinutes` from each window's start, and the last
    // one ends exactly at the window's end: 08:00 to 11:50, then 13:00 to 15:50.
    // The gap between the windows is the 12:00 to 13:00 lunch break.
    serviceWindows: [
      { start: "08:00", end: "12:00" },
      { start: "13:00", end: "16:00" },
    ],
    // Saturday is a half day. Its closing time was not given, so 12:00 is an
    // assumption to confirm with the health office.
    serviceWindowsByWeekday: { 6: [{ start: "08:00", end: "12:00" }] },
    // No booking horizon has been set for BP, so any future service day can be
    // booked. Set `bookingHorizonWeeks` here to limit it; the API and the app follow it.
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

/** True for a service with its own weekly schedule (immunization), which missions never carry. */
function isWeeklyService(key) {
  return getCategory(key)?.scheduling === "weekly";
}

/**
 * True for a doctor service residents only request (general checkup,
 * consultation): it waits in the priority queue until a medical mission has room.
 */
function isQueuedService(key) {
  return getCategory(key)?.scheduling === "queue";
}

/** The reason a weekday is closed for a service, when its config gives one. */
function closedWeekdayReason(key, weekday) {
  return getCategory(key)?.closedWeekdayReasons?.[weekday] ?? null;
}

/** True for a weekly service where the resident chooses the date and time (BP checking, prenatal). */
function residentPicksTime(key) {
  return isWeeklyService(key) && getCategory(key)?.residentPicksTime === true;
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
  isWeeklyService,
  isQueuedService,
  closedWeekdayReason,
  residentPicksTime,
  getQueueRole,
  getCategoryKeysForRole,
  getResidentBookableCategories,
  getEligibleProviderRoles,
  isProviderRoleAllowed,
  resolveDurationMinutes,
  validateDurationForCategory,
};
