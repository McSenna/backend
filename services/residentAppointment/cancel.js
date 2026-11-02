"use strict";

const { markCancelled, cancelAutomaticVisit } = require("../immunization/appointmentCancellation");
const { loadAppointmentOrFail } = require("../appointment/lookup");
const { processMissionSchedulePriorityQueue } = require("../triageQueue");
const logger = require("../../utils/logger");
const {
  CANCELLABLE_STATUSES,
  assertOwnership,
  assertStatusAllows,
  loadFullAppointment,
  logAction,
  notify,
  serviceLabelOf,
} = require("./shared");

const trimReason = (reason) =>
  typeof reason === "string" ? reason.trim().slice(0, 1000) : "";

const releaseFreedSlot = async (missionScheduleId) => {
  if (!missionScheduleId) return;
  try {
    await processMissionSchedulePriorityQueue(missionScheduleId, { staffId: null });
  } catch (error) {
    logger.warn("Failed to reprocess mission queue after resident cancellation", {
      missionScheduleId: String(missionScheduleId),
      error: error?.message,
    });
  }
};

const buildNotifications = ({ appointment, serviceLabel, reason, staffId }) => {
  const suffix = reason ? ` Reason: ${reason}` : "";

  return [
    {
      recipient: appointment.resident,
      appointment: appointment._id,
      type: "appointment_cancelled",
      title: "Appointment Cancelled",
      body: `Your ${serviceLabel} appointment has been cancelled.${suffix}`,
      tone: "warning",
    },
    staffId
      ? {
          recipient: staffId,
          appointment: appointment._id,
          type: "appointment_cancelled",
          title: "Appointment Cancelled by Resident",
          body: `A ${serviceLabel} appointment you scheduled was cancelled by the resident.${suffix}`,
          tone: "warning",
        }
      : null,
  ];
};

const cancelAppointmentByResident = async ({ req, appointmentId, residentId, reason, actorRole }) => {
  let appointment = await loadAppointmentOrFail(appointmentId);
  assertOwnership(appointment, residentId, actorRole, "cancel");
  if (appointment.immunizationBabyId) await require('../immunization/appointmentAccess').assertAppointmentLink(appointment);

  if (appointment.status === "cancelled") {
    return { appointment: await loadFullAppointment(appointment._id), alreadyCancelled: true };
  }

  assertStatusAllows(appointment, CANCELLABLE_STATUSES, "cancelled");

  const freedMissionScheduleId = appointment.missionSchedule;
  const staffId = appointment.assignedBy;
  const serviceLabel = serviceLabelOf(appointment.consultationType);
  const trimmedReason = trimReason(reason);

  if (appointment.immunizationBabyId) {
    const result = await cancelAutomaticVisit({appointmentId,residentId,actorRole,reason:trimmedReason});
    appointment = result.appointment;
    if (result.alreadyCancelled) return {appointment:await loadFullAppointment(appointment._id),alreadyCancelled:true};
  } else {
    markCancelled(appointment,residentId,trimmedReason);
    await appointment.save();
  }

  await releaseFreedSlot(freedMissionScheduleId);

  await notify(
    buildNotifications({ appointment, serviceLabel, reason: trimmedReason, staffId }),
    "resident-cancel"
  );

  logAction({
    req,
    action: "APPOINTMENT_CANCELLED",
    residentId,
    actorRole,
    appointmentId: appointment._id,
    description: `${serviceLabel} appointment was cancelled by the resident`,
    metadata: {
      consultationType: appointment.consultationType,
      reason: trimmedReason,
      freedMissionScheduleId: freedMissionScheduleId ? String(freedMissionScheduleId) : null,
    },
  });

  return { appointment: await loadFullAppointment(appointment._id), alreadyCancelled: false };
};

module.exports = { cancelAppointmentByResident };
