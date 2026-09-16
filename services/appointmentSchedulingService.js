"use strict";

const { conflict, badRequest } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const { assertValidObjectId } = require("../utils/objectId");
const { BOOKED_STATUSES } = require("./queueScope");
const { getFirstAssignablePendingAppointmentForMission } = require("./triageQueue");
const { validateAndAssignSlot } = require("./appointmentSlotService");
const { loadAppointmentOrFail, loadMissionOrFail } = require("./appointmentLookup");

const assertSlotPayload = ({ missionScheduleId, categoryKey, slotStart }) => {
  if (!missionScheduleId || !categoryKey || !slotStart) {
    throw badRequest(
      "A mission schedule, consultation category, and time slot are all required.",
      ERROR_CODES.MISSING_FIELDS
    );
  }
  assertValidObjectId(missionScheduleId, "mission schedule");
};

const assertTriageOrder = async (missionScheduleId, appointment) => {
  const next = await getFirstAssignablePendingAppointmentForMission(missionScheduleId);
  if (!next) {
    throw conflict(
      "There is no assignable pending appointment for this mission schedule.",
      ERROR_CODES.CONFLICT
    );
  }
  if (String(next.appointmentId) !== String(appointment._id)) {
    throw conflict(
      "A higher-priority patient is next in the triage queue and must be scheduled first.",
      ERROR_CODES.TRIAGE_ORDER_VIOLATION
    );
  }
};

const resolveMissionCategory = (mission, appointment, categoryKey) => {
  if (String(appointment.consultationType) !== String(categoryKey)) {
    throw badRequest(
      "The selected category does not match the patient's requested consultation type.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const missionCategory = mission.categories?.find((c) => c.categoryKey === categoryKey);
  if (!missionCategory) {
    throw badRequest(
      "This mission schedule has no slots for the selected consultation category.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return missionCategory;
};

const assignSlot = async ({ appointmentId, payload, staffId }) => {
  const { missionScheduleId, categoryKey, slotStart } = payload;
  assertSlotPayload(payload);

  const appointment = await loadAppointmentOrFail(appointmentId);
  if (appointment.status !== "pending") {
    throw conflict(
      `Only pending appointments can be scheduled. This appointment is already ${appointment.status}.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  const mission = await loadMissionOrFail(missionScheduleId);
  const missionCategory = resolveMissionCategory(mission, appointment, categoryKey);

  await assertTriageOrder(missionScheduleId, appointment);

  await validateAndAssignSlot({
    appointment,
    mission,
    categoryKey,
    durationMinutes: missionCategory.durationMinutes,
    slotStart,
    staffId,
    isReassign: false,
  });

  return appointment;
};

const reassignSlot = async ({ appointmentId, payload, staffId }) => {
  const { missionScheduleId, categoryKey, durationMinutes, slotStart } = payload;
  assertSlotPayload(payload);

  const appointment = await loadAppointmentOrFail(appointmentId);
  if (!BOOKED_STATUSES.includes(appointment.status)) {
    throw conflict(
      `Only confirmed or rescheduled appointments can be moved. This appointment is ${appointment.status}.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  const mission = await loadMissionOrFail(missionScheduleId);

  await validateAndAssignSlot({
    appointment,
    mission,
    categoryKey,
    durationMinutes,
    slotStart,
    staffId,
    isReassign: true,
  });

  return appointment;
};

module.exports = { assignSlot, reassignSlot };
