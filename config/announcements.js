"use strict";

// Kept in step with ANNOUNCEMENT_LIMITS in the app's announcementRules.ts.
const ANNOUNCEMENT_LIMITS = Object.freeze({
  titleMin: 5,
  titleMax: 120,
  messageMin: 10,
  messageMax: 800,
  locationMin: 3,
  locationMax: 160,
  // How far ahead an event may be announced.
  maxDaysAhead: 365,
});

const ANNOUNCEMENT_PAGE = Object.freeze({
  defaultLimit: 20,
  maxLimit: 50,
});

// Kept in step with ANNOUNCEMENT_AUDIENCES in the app's announcement.types.ts.
const ANNOUNCEMENT_AUDIENCES = Object.freeze(["Patients", "Staff", "Everyone"]);

const STAFF_ROLES = Object.freeze(["admin", "doctor", "midwife", "bhw"]);

// Which account roles an audience reaches, for both delivery and the shared feed.
const AUDIENCE_ROLES = Object.freeze({
  Patients: Object.freeze(["resident"]),
  Staff: STAFF_ROLES,
  Everyone: Object.freeze(["resident", ...STAFF_ROLES]),
});

module.exports = { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_PAGE, ANNOUNCEMENT_AUDIENCES, AUDIENCE_ROLES };
