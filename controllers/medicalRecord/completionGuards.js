"use strict";

const Appointment = require("../../models/Appointment");
const { COMPLETABLE_STATUSES } = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const { badRequest, conflict } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { validateMedicalRecordInput } = require("../../utils/medicalRecordValidation");
const { validateDispenseInput } = require("../../utils/dispenseValidation");

const alreadyCompletedResponse = async (res, appointmentId, appointment) => {
  const record = await MedicalRecord.findOne({ appointment: appointmentId }).lean();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "This appointment was already completed.",
    appointment,
    medicalRecord: record ?? null,
    alreadyCompleted: true,
  });
};

const assertCompletable = (status) => {
  if (COMPLETABLE_STATUSES.includes(status)) return;
  throw conflict(
    status === "pending"
      ? "This appointment has not been scheduled yet. Assign it to a mission before completing it."
      : `An appointment that is ${status} cannot be completed.`,
    ERROR_CODES.INVALID_STATUS_TRANSITION
  );
};

const validateSubmission = (serviceType, body) => {
  const validation = validateMedicalRecordInput(serviceType, body?.medicalRecord ?? body ?? {});
  if (!validation.ok) {
    throw badRequest(validation.errors.join(" "), ERROR_CODES.VALIDATION_ERROR);
  }

  const dispense = validateDispenseInput(body?.inventoryItems);
  if (!dispense.ok) {
    throw badRequest(dispense.errors.join(" "), ERROR_CODES.VALIDATION_ERROR);
  }

  return { validation, dispense };
};

const loadCompletedPair = (appointmentId, recordId) =>
  Promise.all([
    Appointment.findById(appointmentId)
      .populate("resident", "fullname email dateOfBirth gender phone")
      .populate("completedBy", "fullname role")
      .populate("assignedBy", "fullname role")
      .lean(),
    MedicalRecord.findById(recordId)
      .populate("provider", "fullname role")
      .populate("resident", "fullname")
      .lean(),
  ]);

module.exports = {
  alreadyCompletedResponse,
  assertCompletable,
  validateSubmission,
  loadCompletedPair,
};
