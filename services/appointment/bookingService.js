"use strict";

const { appointmentForResident } = require("../medicalRecord/residentRecordView");
const Appointment = require("../../models/Appointment");
const User = require("../../models/User");
const { isWeeklyService, residentPicksTime } = require("../../config/consultationCategories");
const { announceAutoConfirm } = require("../triage/autoConfirmNotifier");
const { parseRequestKey, parseServiceKey } = require("./bookingRequest");
const { findEarlierBooking, recoverFromDuplicateKey } = require("./bookingReplay");
const { parseQueuedRequest } = require("../doctorQueue/request");
const { commitQueuedRequest } = require("../doctorQueue/submit");
const { announceQueued } = require("../doctorQueue/notifications");
const { allocateQueuedRequests } = require("../doctorQueue/allocation");
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
 * A queued doctor service has nothing to choose, so it lists no dates; a weekly
 * service lists its own days; a regular-schedule service (BP checking,
 * prenatal) lists a calendar month and the open slots of the chosen date.
 */
const listBookingOptions = async (consultationType, { month = null, date = null } = {}) => {
  const key = parseServiceKey(consultationType);
  if (residentPicksTime(key)) return listRegularOptions(key, { month, date });
  if (!isWeeklyService(key)) return { consultationType: key, scheduling: "queue" };
  return {
    consultationType: key,
    scheduling: "weekly",
    intervalMinutes: scheduleOf(key).intervalMinutes,
    days: await listWeeklyDays(key),
  };
};

const SUBMITTERS = {
  regular: { parse: parseRegularRequest, commit: commitRegularBooking },
  weekly: { parse: parseWeeklyRequest, commit: commitWeeklyBooking },
  queue: { parse: parseQueuedRequest, commit: commitQueuedRequest },
};

// Every service that is not on its own weekly schedule is a mission service,
// and residents only request those: the queue places them (scheduling "queue").
const schedulingOf = (categoryKey) => {
  if (residentPicksTime(categoryKey)) return "regular";
  return isWeeklyService(categoryKey) ? "weekly" : "queue";
};

/**
 * What happens after a new request or booking is saved. A booking is confirmed
 * already. A queued request is acknowledged first, then offered to every
 * upcoming mission, so a resident whose request lands on an open mission hears
 * "queued" and then "confirmed", in that order, and nothing is announced unsaved.
 */
const announceSaved = async (scheduling, appointment, resident) => {
  if (scheduling !== "queue") {
    announceAutoConfirm({
      appointment: { consultationType: appointment.consultationType, resident },
      updated: appointment,
      staffId: null,
      doctorLabel: null,
    });
    return;
  }
  await announceQueued(appointment);
  await allocateQueuedRequests({ route: "resident-request" });
};

/**
 * Saves a resident's booking or request. The resident is the signed-in user;
 * the body only says what (and, for services where the resident picks, when).
 * Mission services are queued without a time; BP checking and prenatal keep
 * the start the resident chose; immunization gets a server-assigned time.
 */
const bookAppointment = async ({ residentId, payload = {} }) => {
  const now = new Date();
  const categoryKey = parseServiceKey(payload.consultationType);
  const requestKey = parseRequestKey(payload.requestKey);
  const scheduling = schedulingOf(categoryKey);
  const { parse, commit } = SUBMITTERS[scheduling];
  const request = parse(categoryKey, payload, now);

  const resident = await User.findById(residentId).lean();
  if (!resident) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  const earlier = await findEarlierBooking(resident._id, requestKey)?.lean();
  const saved = earlier
    ? { appointment: earlier, replayed: true }
    : await commit({ request, resident, requestKey, now }).catch((error) =>
        recoverFromDuplicateKey(error, { residentId: resident._id, requestKey })
      );
  const { appointment, replayed, providerId } = saved;

  // Only after the write has committed. A replay of a queued request repeats
  // the receipt, which its dedupe key turns into a no-op once it was delivered,
  // so a first try that saved but lost its notification is still acknowledged.
  if (!replayed) await announceSaved(scheduling, appointment, resident);
  // Never once placed: a late "queued" after "confirmed" would read as a step back.
  else if (scheduling === "queue" && appointment.status === "pending") await announceQueued(appointment);

  return {
    populated: await loadBookedAppointment(appointment._id),
    replayed,
    categoryKey: appointment.consultationType,
    providerId,
    scheduling,
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
