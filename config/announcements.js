"use strict";

// Kept in step with ANNOUNCEMENT_LIMITS in the app's announcement.constants.ts.
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

module.exports = { ANNOUNCEMENT_LIMITS, ANNOUNCEMENT_PAGE };
