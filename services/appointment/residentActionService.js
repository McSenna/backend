"use strict";

const { cancelAppointmentByResident } = require("../residentAppointment/cancel");
const { rescheduleAppointmentByResident } = require("../residentAppointment/reschedule");
const {
  getRescheduleOptionsForAppointment,
} = require("../residentAppointment/rescheduleOptions");
const {
  CANCELLABLE_STATUSES,
  RESCHEDULABLE_STATUSES,
} = require("../residentAppointment/shared");

module.exports = {
  cancelAppointmentByResident,
  rescheduleAppointmentByResident,
  getRescheduleOptionsForAppointment,
  CANCELLABLE_STATUSES,
  RESCHEDULABLE_STATUSES,
};
