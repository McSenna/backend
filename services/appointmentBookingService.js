"use strict";

const Appointment = require("../models/Appointment");
const User = require("../models/User");
const { getResidentBookableCategories } = require("../config/consultationCategories");
const { computeAgeYears, ageToTier } = require("../utils/priorityQueue");
const { processUpcomingMissionSchedulesPriorityQueue } = require("./triageQueue");
const { resolvePreferredProvider } = require("./appointmentProviderService");
const { badRequest, notFound } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

const trimTo = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const MISSION_POPULATE = "date morningStart morningEnd afternoonStart afternoonEnd";

const bookAppointment = async ({ residentId, payload }) => {
  const { consultationType, description, additionalNotes, preferredProvider, isUrgent } = payload;
  if (!consultationType) {
    throw badRequest("Please select a service type.", ERROR_CODES.MISSING_FIELDS);
  }
  const key = String(consultationType).trim();

  const bookable = getResidentBookableCategories().some((category) => category.key === key);
  if (!bookable) {
    throw badRequest("The selected service is not available.", ERROR_CODES.VALIDATION_ERROR);
  }

  const user = await User.findById(residentId).lean();
  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  const providerId = await resolvePreferredProvider(preferredProvider, key);

  const age = computeAgeYears(user.dateOfBirth);
  const priorityTag = ageToTier(age);

  const appointment = await Appointment.create({
    resident: user._id,
    consultationType: key,
    description: trimTo(description, 4000),
    additionalNotes: trimTo(additionalNotes, 1000),
    preferredProvider: providerId,
    isUrgent: Boolean(isUrgent),
    status: "pending",
    ageTier: priorityTag,
    prioritySortKey: priorityTag,
    ageAtSubmission: age,
    statusHistory: [{ status: "pending", timestamp: new Date(), changedBy: null }],
  });

  await processUpcomingMissionSchedulesPriorityQueue({ staffId: null });

  const populated = await Appointment.findById(appointment._id)
    .populate("resident", "fullname email dateOfBirth")
    .populate("preferredProvider", "fullname role")
    .populate("missionSchedule", MISSION_POPULATE)
    .lean();

  return { appointment, populated, categoryKey: key, providerId };
};

const listResidentAppointments = (residentId) =>
  Appointment.find({ resident: residentId })
    .sort({ createdAt: -1 })
    .populate("missionSchedule", MISSION_POPULATE)
    .populate("preferredProvider", "fullname role")
    .populate("assignedBy", "fullname role")
    .populate("completedBy", "fullname role")
    .populate("medicalRecord")
    .lean();

module.exports = { bookAppointment, listResidentAppointments };
