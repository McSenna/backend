"use strict";

const { getCategory } = require("../../config/consultationCategories");

const takesFirstOpenSlot = (categoryKey) => getCategory(categoryKey)?.rescheduleToFirstSlot === true;

/** Priority reschedules sort first, earliest reschedule first; everything else ranks after them. */
const reschedulePriorityRank = (appointment) =>
  appointment?.reschedulePriorityAt
    ? new Date(appointment.reschedulePriorityAt).getTime()
    : Number.POSITIVE_INFINITY;

module.exports = { takesFirstOpenSlot, reschedulePriorityRank };
