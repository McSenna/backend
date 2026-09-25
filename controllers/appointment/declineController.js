"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { declineAppointment } = require("../../services/appointment/declineService");
const { announceDecline } = require("../../services/appointment/declineFlow");

exports.rejectAppointment = asyncHandler(async (req, res) => {
  const appointmentId = assertValidObjectId(req.params.id, "appointment");
  const actorId = req.user.userId;

  const result = await declineAppointment({
    appointmentId,
    reason: req.body.reason,
    actorId,
  });

  if (result.alreadyDeclined) {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "This appointment was already declined.",
      appointment: result.appointment,
    });
  }

  const populated = await announceDecline({ ...result, actorId });

  await createSystemLog({
    req,
    action: "APPOINTMENT_REJECTED",
    user: { _id: actorId, role: req.user.role },
    role: req.user.role,
    description: "Medical staff rejected an appointment request",
    resource: "Appointment",
    resourceId: String(result.appointment._id),
    metadata: { reason: result.appointment.declineReason || "" },
  });

  return res.json({
    success: true,
    message: "Appointment declined.",
    appointment: populated,
  });
});
