"use strict";

const { QUEUE_ACTIVE_STATUSES } = require("../../models/Appointment");
const { BOOKED_STATUSES, SLOT_OCCUPYING_STATUSES, queueFilter } = require("../queueScope");

const TREND_DAYS = 60;

const ROLE_INVENTORY_CATEGORIES = {
  midwife: ["vaccine"],
  doctor: ["medicine"],
  bhw: [],
  admin: ["vaccine", "medicine", "supply"],
};

const WAITING_STATUSES = BOOKED_STATUSES;
const ACTIVE_STATUSES = QUEUE_ACTIVE_STATUSES;

const scopeFilter = queueFilter;

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
