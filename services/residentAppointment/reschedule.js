"use strict";

const { pushStatusHistory } = require("../../models/Appointment");
const { loadAppointmentOrFail, loadMissionOrFail } = require("../appointmentLookup");
const { assertSlotIsAvailable } = require("../appointmentSlotService");
const { processMissionSchedulePriorityQueue } = require("../triageQueue");
const { resolveDurationMinutes } = require("../../config/consultationCategories");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const logger = require("../../utils/logger");
const {
  RESCHEDULABLE_STATUSES,
  assertOwnership,
  assertStatusAllows,
  formatSlotLabels,
  loadFullAppointment,
  logAction,
  notify,
  serviceLabelOf,
} = require("./shared");

const missionDurationFor = (mission, consultationType) => {
  const missionCategory = mission.categories?.find((c) => c.categoryKey === consultationType);
  return missionCategory?.durationMinutes || resolveDurationMinutes(consultationType) || 30;
};

const parseFutureSlotStart = (slotStart) => {
  const date = new Date(slotStart);
  if (Number.isNaN(date.getTime())) {
    throw badRequest("The selected time is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (date.getTime() <= Date.now()) {
    throw badRequest("Cannot reschedule to a past date or time.", ERROR_CODES.VALIDATION_ERROR);
  }
  return date;
};

const releasePreviousMission = async (previousMissionId, nextMissionId) => {
  if (!previousMissionId || String(previousMissionId) === String(nextMissionId)) return;
  try {
    await processMissionSchedulePriorityQueue(previousMissionId, { staffId: null });
  } catch (error) {
    logger.warn("Failed to reprocess previous mission queue after resident reschedule", {
      missionScheduleId: String(previousMissionId),
      error: error?.message,
    });
  }
};

const buildNotifications = ({ appointment, serviceLabel, labels, staffId }) => {
  const when = `${labels.date} at ${labels.time}`;

  return [
    {
      recipient: appointment.resident,
      appointment: appointment._id,
      type: "appointment_rescheduled",
      title: "Appointment Rescheduled",
      body: `Your ${serviceLabel} appointment has been rescheduled to ${when}.`,
      time: labels.time,
      tone: "info",
    },
    staffId
      ? {
          recipient: staffId,
          appointment: appointment._id,
          type: "appointment_rescheduled",
          title: "Appointment Rescheduled by Resident",
          body: `A ${serviceLabel} appointment you scheduled was moved by the resident to ${when}.`,
          time: labels.time,
          tone: "info",
        }
      : null,
  ];
};

const rescheduleAppointmentByResident = async ({
  req,
  appointmentId,
  residentId,
  missionScheduleId,
  slotStart,
  actorRole,
}) => {
  if (!missionScheduleId || !slotStart) {
    throw badRequest("Mission schedule and new time slot are required.", ERROR_CODES.MISSING_FIELDS);
  }

  const missionId = assertValidObjectId(missionScheduleId, "mission schedule");

  const appointment = await loadAppointmentOrFail(appointmentId);
  assertOwnership(appointment, residentId, actorRole, "reschedule");
  assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

  const mission = await loadMissionOrFail(missionId);
  const durationMinutes = missionDurationFor(mission, appointment.consultationType);

  const slotStartDate = parseFutureSlotStart(slotStart);
  const slotEndDate = new Date(slotStartDate.getTime() + durationMinutes * 60 * 1000);

  await assertSlotIsAvailable({ appointment, mission, slotStartDate, slotEndDate });

  const previousMissionId = appointment.missionSchedule;
  const previousSlotStart = appointment.slotStart;
  const staffId = appointment.assignedBy;

  appointment.missionSchedule = mission._id;
  appointment.assignedCategoryKey = appointment.consultationType;
  appointment.assignedDurationMinutes = durationMinutes;
  appointment.slotStart = slotStartDate;
  appointment.slotEnd = slotEndDate;
  appointment.status = "rescheduled";
  if (!appointment.approvedAt) appointment.approvedAt = new Date();

  pushStatusHistory(appointment, "rescheduled", residentId, "Rescheduled by resident");
  await appointment.save();

  await releasePreviousMission(previousMissionId, mission._id);

  const serviceLabel = serviceLabelOf(appointment.consultationType);
  const labels = formatSlotLabels(slotStartDate);

  await notify(
    buildNotifications({ appointment, serviceLabel, labels, staffId }),
    "resident-reschedule"
  );

  logAction({
    req,
    action: "APPOINTMENT_RESCHEDULED",
    residentId,
    actorRole,
    appointmentId: appointment._id,
    description: `${serviceLabel} appointment was rescheduled by the resident to ${labels.date} ${labels.time}`,
    metadata: {
      consultationType: appointment.consultationType,
      missionScheduleId: String(mission._id),
      previousSlotStart: previousSlotStart ? new Date(previousSlotStart).toISOString() : null,
      slotStart: slotStartDate.toISOString(),
      slotEnd: slotEndDate.toISOString(),
    },
  });

  return { appointment: await loadFullAppointment(appointment._id) };
};

module.exports = { rescheduleAppointmentByResident };
