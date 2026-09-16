"use strict";

const TREND_DAYS = 60;

const ROLE_INVENTORY_CATEGORIES = {
  midwife: ["vaccine"],
  doctor: ["medicine"],
  bhw: [],
  admin: ["vaccine", "medicine", "supply"],
};

const WAITING_STATUSES = ["confirmed", "rescheduled"];
const ACTIVE_STATUSES = ["confirmed", "rescheduled", "processing"];
const SLOT_OCCUPYING_STATUSES = ["confirmed", "rescheduled", "processing", "completed"];

const scopeFilter = (categoryKeys) =>
  categoryKeys === null ? {} : { consultationType: { $in: categoryKeys } };

const serviceScopeFilter = (categoryKeys) =>
  categoryKeys === null ? {} : { serviceType: { $in: categoryKeys } };

module.exports = {
  TREND_DAYS,
  ROLE_INVENTORY_CATEGORIES,
  WAITING_STATUSES,
  ACTIVE_STATUSES,
  SLOT_OCCUPYING_STATUSES,
  scopeFilter,
  serviceScopeFilter,
};
