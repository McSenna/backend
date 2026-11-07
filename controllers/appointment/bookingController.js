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
const QUEUED_MESSAGE =
  "Your appointment request has been queued. Your appointment date and time will be assigned when a doctor's medical mission schedule becomes available.";
const SCHEDULED_MESSAGE = "Your appointment request has been scheduled from the queue.";

// A queued request answers with where it stands now: still waiting, or already
// placed on a mission that had room. Never "confirmed" while it has no time.
const messageFor = (scheduling, appointment) => {
  if (scheduling !== "queue") return CONFIRMED_MESSAGE;
  return appointment?.status === "pending" ? QUEUED_MESSAGE : SCHEDULED_MESSAGE;
};

exports.getBookingOptions = asyncHandler(async (req, res) => {
  const { consultationType, month, date } = req.query;
  const options = await listBookingOptions(consultationType, { month, date });
  return res.json({
    success: true,
    message: "Open appointment times loaded.",
    ...options,
  });
});

exports.createAppointment = asyncHandler(async (req, res) => {
  const { populated, replayed, categoryKey, providerId, scheduling } = await bookAppointment({
    residentId: req.user.userId,
    payload: req.body,
  });
  const message = messageFor(scheduling, populated);

  // A replay is the same booking answered again, so it is not logged twice.
  if (replayed) {
    return res.status(HTTP_STATUS.OK).json({ success: true, message, appointment: populated });
  }

  await createSystemLog({
    req,
    action: "APPOINTMENT_CREATED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description:
      scheduling === "queue"
        ? "Resident requested an appointment, added to the queue"
        : "Resident booked an appointment, confirmed automatically",
    resource: "Appointment",
    resourceId: String(populated._id),
    metadata: {
      consultationType: categoryKey,
      scheduling,
      preferredProvider: providerId ? String(providerId) : null,
      isUrgent: Boolean(populated.isUrgent),
      missionScheduleId: populated.missionSchedule?._id ? String(populated.missionSchedule._id) : null,
      slotStart: populated.slotStart ? new Date(populated.slotStart).toISOString() : null,
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({ success: true, message, appointment: populated });
});

exports.getMyAppointments = asyncHandler(async (req, res) => {
  const appointments = await listResidentAppointments(req.user.userId);
  return res.json({
    success: true,
    message: "Appointments loaded successfully.",
    appointments,
  });
});
