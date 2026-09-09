"use strict";

/**
 * The MaslogCare service catalogue — the single source of truth for what a
 * resident can book and who may provide it.
 *
 * `key` is the stable identifier stored on the appointment and used in every
 * API payload; `label` is the only text any screen should show. Nothing else
 * in the system spells these names out, so renaming a service here renames it
 * everywhere without a second list drifting out of step.
 *
 * Durations are what the health team blocks out when a slot is assigned:
 * ranges use min/max, fixed services use durationMinutes only.
 *
 * `queueRole` is the single staff role that owns the service — the one whose
 * queue the appointment lands in, and the only role offered as a provider. It
 * is the routing rule itself, stated once here rather than re-derived per
 * screen, so Consultation cannot mean "doctor" on one surface and "anyone" on
 * the next. Everything else in the system asks this file which role owns a
 * service; nothing else decides it.
 *
 * `order` is the sequence residents see. It is set explicitly rather than left
 * to array position so the booking screen's ordering is a stated decision.
 */
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

/** Where a service with no stated owner goes, so nothing routes nowhere. */
const DEFAULT_QUEUE_ROLE = "doctor";
const DEFAULT_PROVIDER_ROLES = Object.freeze([DEFAULT_QUEUE_ROLE]);

/** Roles that own a queue of their own. Admin oversees all of them. */
const QUEUE_ROLES = Object.freeze(["doctor", "midwife", "bhw"]);

/**
 * Roles that may open, change or close a mission schedule.
 *
 * Kept beside the service policy because it is the same kind of rule — what a
 * role is for — and because the API and the clients must not each hold their
 * own copy. `canCreateMission` is what the UI asks before rendering the button;
 * the route guard is what actually enforces it.
 */
const MISSION_MANAGER_ROLES = Object.freeze(["doctor", "admin"]);

function canCreateMission(role) {
  return MISSION_MANAGER_ROLES.includes(normalizeRole(role));
}

const byKey = Object.fromEntries(CONSULTATION_CATEGORIES.map((c) => [c.key, c]));

/**
 * service key → owning role, flattened for callers that want the whole map.
 *
 * Derived from the catalogue rather than written out a second time: a service
 * added above appears here automatically, and the two can never disagree.
 */
const SERVICE_QUEUE_MAPPING = Object.freeze(
  Object.fromEntries(CONSULTATION_CATEGORIES.map((c) => [c.key, c.queueRole || DEFAULT_QUEUE_ROLE]))
);

function normalizeRole(role) {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function getCategory(key) {
  return byKey[key] || null;
}

/**
 * The role whose queue this service belongs in.
 *
 * The one function that answers "who handles this?". Booking, the staff queue
 * and every filter go through it, so the answer cannot differ between them.
 * Unknown services fall to the default rather than returning null: an
 * appointment that reaches nobody's queue is worse than one in the wrong queue,
 * because nothing surfaces it.
 */
function getQueueRole(key) {
  const cat = getCategory(key);
  return cat?.queueRole || DEFAULT_QUEUE_ROLE;
}

/**
 * The services a staff role is responsible for.
 *
 * Admin gets every key — they oversee all three queues rather than holding one.
 * An unrecognised role gets nothing, so a new role cannot silently inherit
 * another's workload.
 */
function getCategoryKeysForRole(role) {
  const normalized = normalizeRole(role);
  if (normalized === "admin") return CONSULTATION_CATEGORIES.map((c) => c.key);
  return CONSULTATION_CATEGORIES.filter(
    (c) => (c.queueRole || DEFAULT_QUEUE_ROLE) === normalized
  ).map((c) => c.key);
}

/**
 * The services a resident may book, in display order.
 *
 * Staff scheduling reads the full catalogue; the booking screen reads this, so
 * an internal service added later for the health team does not silently appear
 * on a resident's form.
 */
function getResidentBookableCategories() {
  return CONSULTATION_CATEGORIES.filter((c) => c.residentBookable !== false).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
}

/**
 * Staff roles allowed to deliver a service — the owning role, and only it.
 *
 * Derived from `queueRole` so the provider a resident may request and the queue
 * the appointment lands in are the same decision. Unknown services grant
 * nothing, so an unrecognised key cannot be booked against any staff member.
 */
function getEligibleProviderRoles(key) {
  const cat = getCategory(key);
  if (!cat) return [];
  return [cat.queueRole || DEFAULT_QUEUE_ROLE];
}

/** Whether a staff role may deliver a service — the check the API applies. */
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
