"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const {
  bookAppointment,
  listBookingOptions,
  listResidentAppointments,
} = require("../../services/appointment/bookingService");

const CONFIRMED_MESSAGE = "Your appointment is confirmed.";

exports.getBookingOptions = asyncHandler(async (req, res) => {
  const options = await listBookingOptions(req.query.consultationType);
  return res.json({
    success: true,
    message: "Open appointment times loaded.",
    ...options,
  });
});

exports.createAppointment = asyncHandler(async (req, res) => {
  const { populated, replayed, categoryKey, providerId } = await bookAppointment({
    residentId: req.user.userId,
    payload: req.body,
  });

  // A replay is the same booking answered again, so it is not logged twice.
  if (replayed) {
    return res.status(HTTP_STATUS.OK).json({ success: true, message: CONFIRMED_MESSAGE, appointment: populated });
  }

  await createSystemLog({
    req,
    action: "APPOINTMENT_CREATED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Resident booked an appointment, confirmed automatically",
    resource: "Appointment",
    resourceId: String(populated._id),
    metadata: {
      consultationType: categoryKey,
      preferredProvider: providerId ? String(providerId) : null,
      isUrgent: Boolean(populated.isUrgent),
      missionScheduleId: String(populated.missionSchedule?._id ?? ""),
      slotStart: new Date(populated.slotStart).toISOString(),
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: CONFIRMED_MESSAGE,
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
