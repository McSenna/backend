"use strict";

const Appointment = require("../../models/Appointment");
const Notification = require("../../models/Notification");
const { SLOT_OCCUPYING_STATUSES } = require("../queueScope");
const { createSystemLog } = require("../systemLogService");
const { getCategory } = require("../../config/consultationCategories");
const logger = require("../../utils/logger");
const { conflict, forbidden } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const CANCELLABLE_STATUSES = Object.freeze(["pending", "confirmed", "rescheduled"]);

const RESCHEDULABLE_STATUSES = Object.freeze(["confirmed", "rescheduled"]);

const MISSION_POPULATE = "date morningStart morningEnd afternoonStart afternoonEnd";

const serviceLabelOf = (categoryKey) => getCategory(categoryKey)?.label ?? "appointment";

const loadFullAppointment = (id) =>
  Appointment.findById(id)
    .populate("missionSchedule", MISSION_POPULATE)
    .populate("preferredProvider", "fullname role")
    .populate("assignedBy", "fullname role")
    .populate("completedBy", "fullname role")
    .populate("medicalRecord")
    .lean();

const assertOwnership = (appointment, residentId, actorRole, action) => {
  const isOwner = String(appointment.resident) === String(residentId);
  if (isOwner || actorRole === "admin") return;
  throw forbidden(
    `You do not have permission to ${action} this appointment.`,
    ERROR_CODES.FORBIDDEN
  );
};

const assertStatusAllows = (appointment, allowedStatuses, action) => {
  if (allowedStatuses.includes(appointment.status)) return;
  throw conflict(
    `An appointment that is ${appointment.status} can no longer be ${action}.`,
    ERROR_CODES.INVALID_STATUS_TRANSITION
  );
};

const notify = async (docs, context) => {
  try {
    await Notification.insertMany(docs.filter(Boolean));
  } catch (error) {
    logger.warn("Resident appointment notification failed", {
      context,
      error: error?.message,
    });
  }
};

const logAction = ({ req, action, residentId, actorRole, description, appointmentId, metadata }) => {
  if (!req) return;
  void createSystemLog({
    req,
    action,
    user: { _id: residentId, role: actorRole || "resident" },
    role: actorRole || "resident",
    description,
    resource: "Appointment",
    resourceId: String(appointmentId),
    metadata,
  });
};

const formatSlotLabels = (date) => ({
  date: date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }),
  time: date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
});

module.exports = {
  CANCELLABLE_STATUSES,
  RESCHEDULABLE_STATUSES,
  MISSION_POPULATE,
  SLOT_OCCUPYING_STATUSES,
  serviceLabelOf,
  loadFullAppointment,
  assertOwnership,
  assertStatusAllows,
  notify,
  logAction,
  formatSlotLabels,
};
