"use strict";

const Appointment = require("../../models/Appointment");
const { pushStatusHistory } = require("../../models/Appointment");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { notFound, conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { assertMayComplete } = require("../../services/medicalRecord/serviceOwnership");

const STARTABLE_STATUSES = ["confirmed", "rescheduled"];

exports.startProcessing = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "appointment");

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
  }

  assertMayComplete(req.user, appointment.consultationType);

  if (appointment.status === "processing") {
    return res.json({
      success: true,
      message: "This appointment is already being served.",
      appointment,
    });
  }

  if (!STARTABLE_STATUSES.includes(appointment.status)) {
    throw conflict(
      `An appointment that is ${appointment.status} cannot be started.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  appointment.status = "processing";
  appointment.processingAt = new Date();
  pushStatusHistory(appointment, "processing", req.user.userId);
  await appointment.save();

  void createSystemLog({
    req,
    action: "APPOINTMENT_PROCESSING",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Health worker started serving an appointment",
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: { serviceType: appointment.consultationType },
  });

  return res.json({
    success: true,
    message: "Appointment is now being served.",
    appointment,
  });
});
