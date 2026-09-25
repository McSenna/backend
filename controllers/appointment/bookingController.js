"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const {
  bookAppointment,
  listResidentAppointments,
} = require("../../services/appointment/bookingService");

exports.createAppointment = asyncHandler(async (req, res) => {
  const { appointment, populated, categoryKey, providerId } = await bookAppointment({
    residentId: req.user.userId,
    payload: req.body,
  });

  await createSystemLog({
    req,
    action: "APPOINTMENT_CREATED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Resident submitted a new appointment request",
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: {
      consultationType: categoryKey,
      preferredProvider: providerId ? String(providerId) : null,
      isUrgent: Boolean(req.body.isUrgent),
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Your appointment is in queue. Please wait for the doctor to assign your schedule.",
    appointment: populated,
  });
});

exports.getMyAppointments = asyncHandler(async (req, res) => {
  const appointments = await listResidentAppointments(req.user.userId);
  return res.json({
    success: true,
    message: "Appointments loaded successfully.",
    appointments,
  });
});
