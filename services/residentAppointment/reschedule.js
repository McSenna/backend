"use strict";

const { loadAppointmentOrFail, loadMissionOrFail } = require("../appointment/lookup");
const { assertMissionOffersCategory, missionDurationFor } = require("../appointment/slotService");
const { commitResidentReschedule } = require("./rescheduleCommit");
const { buildRescheduleNotifications } = require("./rescheduleNotice");
const { isWeeklyService } = require("../../config/consultationCategories");
const { rescheduleWeeklyByResident } = require("../immunization/weeklyReschedule");
const { processMissionSchedulePriorityQueue } = require("../triageQueue");
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

const rescheduleAppointmentByResident = async ({
  req,
  appointmentId,
  residentId,
  missionScheduleId,
  slotStart,
  appointmentDate,
  actorRole,
}) => {
  const appointment = await loadAppointmentOrFail(appointmentId);
  assertOwnership(appointment, residentId, actorRole, "reschedule");
  assertStatusAllows(appointment, RESCHEDULABLE_STATUSES, "rescheduled");

  // A weekly service (immunization) moves to another day with a server-assigned time.
  if (isWeeklyService(appointment.consultationType)) {
    return rescheduleWeeklyByResident({ req, appointment, residentId, actorRole, appointmentDate });
  }

  if (!missionScheduleId || !slotStart) {
    throw badRequest("Mission schedule and new time slot are required.", ERROR_CODES.MISSING_FIELDS);
  }
  const missionId = assertValidObjectId(missionScheduleId, "mission schedule");

  const mission = await loadMissionOrFail(missionId);
  assertMissionOffersCategory(mission, appointment.consultationType);
  const durationMinutes = missionDurationFor(mission, appointment.consultationType);

  const slotStartDate = parseFutureSlotStart(slotStart);

  const previousMissionId = appointment.missionSchedule;
  const previousSlotStart = appointment.slotStart;
  const staffId = appointment.assignedBy;

  const updated = await commitResidentReschedule({
    appointmentId: appointment._id,
    residentId,
    actorRole,
    mission,
    durationMinutes,
    slotStartDate,
  });

  await releasePreviousMission(previousMissionId, mission._id);

  const serviceLabel = serviceLabelOf(appointment.consultationType);
  const labels = formatSlotLabels(slotStartDate);

  await notify(
    buildRescheduleNotifications({ appointment: updated, serviceLabel, labels, staffId }),
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
      slotEnd: updated.slotEnd.toISOString(),
      reschedulePriority: Boolean(updated.reschedulePriorityAt),
    },
  });

  return { appointment: await loadFullAppointment(appointment._id) };
};

module.exports = { rescheduleAppointmentByResident };
