"use strict";

const { listServiceProviders } = require("./appointment/providerController");
const { createAppointment, getMyAppointments } = require("./appointment/bookingController");
const {
  getPendingAppointments,
  listAppointments,
  getQueueOverview,
  getAnalyticsByCategory,
} = require("./appointment/queueController");
const {
  assignAppointment,
  reassignAppointment,
} = require("./appointment/schedulingController");
const { rejectAppointment } = require("./appointment/declineController");
const { suggestSlot } = require("./appointment/slotSuggestionController");
const {
  STAFF_ROLES,
  SLOT_OCCUPYING_STATUSES,
  resolveQueueScope,
  applyCategoryFilter,
} = require("../services/queueScope");

module.exports = {
  listServiceProviders,
  createAppointment,
  getMyAppointments,
  getPendingAppointments,
  listAppointments,
  getQueueOverview,
  getAnalyticsByCategory,
  assignAppointment,
  reassignAppointment,
  rejectAppointment,
  suggestSlot,
  STAFF_ROLES,
  SLOT_OCCUPYING_STATUSES,
  resolveQueueScope,
  applyCategoryFilter,
};
