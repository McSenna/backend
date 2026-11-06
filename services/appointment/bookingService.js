"use strict";

const { appointmentForResident } = require("../medicalRecord/residentRecordView");
const Appointment = require("../../models/Appointment");
const User = require("../../models/User");
const { isWeeklyService, residentPicksTime } = require("../../config/consultationCategories");
const { announceAutoConfirm } = require("../triage/autoConfirmNotifier");
const { listBookableSchedules } = require("./bookableSchedules");
const { parseMissionRequest, parseRequestKey, parseServiceKey } = require("./bookingRequest");
const { findEarlierBooking, recoverFromDuplicateKey } = require("./bookingReplay");
const { commitMissionBooking } = require("./bookingCommit");
const { parseWeeklyRequest } = require("../immunization/weeklyRequest");
const { commitWeeklyBooking } = require("../immunization/weeklyBooking");
const { listWeeklyDays } = require("../immunization/weeklySlots");
const { scheduleOf } = require("../immunization/weeklyCalendar");
const { listRegularOptions } = require("../regularSchedule/availability");
const { parseRegularRequest } = require("../regularSchedule/request");
const { commitRegularBooking } = require("../regularSchedule/booking");
const { notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const MISSION_POPULATE = "date morningStart morningEnd afternoonStart afternoonEnd";

const loadBookedAppointment = (id) =>
  Appointment.findById(id)
    .populate("resident", "fullname email dateOfBirth")
    .populate("preferredProvider", "fullname role")
    .populate("missionSchedule", MISSION_POPULATE)
    .lean();

/**
 * Mission services list mission days and times; a weekly service lists its own
 * days; a regular-schedule service (BP checking) lists a calendar month and the
 * open slots of the chosen date.
 */
const listBookingOptions = async (consultationType, { month = null, date = null } = {}) => {
  const key = parseServiceKey(consultationType);
  if (residentPicksTime(key)) return listRegularOptions(key, { month, date });
  if (!isWeeklyService(key)) {
    return { consultationType: key, scheduling: "mission", schedules: await listBookableSchedules({ categoryKey: key }) };
  }
  return {
    consultationType: key,
    scheduling: "weekly",
    intervalMinutes: scheduleOf(key).intervalMinutes,
    days: await listWeeklyDays(key),
  };
};

/**
 * Books and confirms in one step. The resident is the signed-in user; the body
 * only says what and when. Immunization gets a server-assigned time; mission
 * and regular-schedule services keep the start the resident chose.
 */
const bookAppointment = async ({ residentId, payload = {} }) => {
  const now = new Date();
  const categoryKey = parseServiceKey(payload.consultationType);
  const requestKey = parseRequestKey(payload.requestKey);
  const regular = residentPicksTime(categoryKey);
  const weekly = isWeeklyService(categoryKey) && !regular;
  const parse = regular ? parseRegularRequest : weekly ? parseWeeklyRequest : parseMissionRequest;
  const request = parse(categoryKey, payload, now);

  const resident = await User.findById(residentId).lean();
  if (!resident) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  const earlier = await findEarlierBooking(resident._id, requestKey)?.lean();
  if (earlier) {
    return { populated: await loadBookedAppointment(earlier._id), replayed: true, categoryKey: earlier.consultationType };
  }

  const commit = regular ? commitRegularBooking : weekly ? commitWeeklyBooking : commitMissionBooking;
  const { appointment, replayed, providerId } = await commit({ request, resident, requestKey, now }).catch(
    (error) => recoverFromDuplicateKey(error, { residentId: resident._id, requestKey })
  );

  // Sent only after the transaction commits, and only once per booking.
  if (!replayed) {
    announceAutoConfirm({
      appointment: { consultationType: appointment.consultationType, resident },
      updated: appointment,
      staffId: null,
      doctorLabel: null,
    });
  }

  return {
    populated: await loadBookedAppointment(appointment._id),
    replayed,
    categoryKey: appointment.consultationType,
    providerId,
  };
};

// The resident list's row shape, shared with realtime/publishers/appointments.js.
const residentAppointmentQuery = (filter) =>
  Appointment.find(filter)
    .populate("missionSchedule", MISSION_POPULATE)
    .populate("preferredProvider", "fullname role")
    .populate("assignedBy", "fullname role")
    .populate("completedBy", "fullname role")
    .populate("medicalRecord");

const listResidentAppointments = async (residentId) => {
  const rows = await require('../immunization/appointmentAccess').protectedAppointmentRows(await residentAppointmentQuery({ resident: residentId }).sort({ createdAt: -1 }).lean());
  return rows.map(appointmentForResident);
};

module.exports = { bookAppointment, listBookingOptions, listResidentAppointments, residentAppointmentQuery };
