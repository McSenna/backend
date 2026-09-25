"use strict";

const Appointment = require("../../models/Appointment");
const User = require("../../models/User");
const { sendAppointmentDeclinedEmail } = require("../mailer");
const {
  formatAppointmentDetails,
  formatConsultationTypeLabel,
  formatSlotStartForNotification,
  truncateNotificationBody,
  createNotifications,
} = require("./notifications");
const { reprocessMissionQueue, sendScheduleEmail } = require("./scheduleNotifier");

const TBD_DETAILS = {
  date: "Date TBD",
  time: "Time TBD",
  worker: "Medical mission team",
  location: "Barangay health mission site",
};

const resolveDoctorLabel = async (doctorUserId) => {
  try {
    const doctorUser = await User.findById(doctorUserId).lean();
    return doctorUser?.fullname ?? null;
  } catch {
    return null;
  }
};

const notifyDecline = ({ appointment, actorId, appointmentTypeLabel, timeLabel }) =>
  createNotifications(
    [
      {
        recipient: appointment.resident,
        appointment: appointment._id,
        type: "appointment_declined",
        title: "Appointment declined",
        body: truncateNotificationBody(
          `Your ${appointmentTypeLabel} appointment request was declined.${appointment.declineReason ? ` Reason: ${appointment.declineReason}` : ""}`
        ),
        time: timeLabel,
        tone: "info",
      },
      {
        recipient: actorId,
        appointment: appointment._id,
        type: "appointment_declined",
        title: "Appointment declined",
        body: truncateNotificationBody(
          `A ${appointmentTypeLabel} appointment request was declined by medical staff.`
        ),
        time: timeLabel,
        tone: "info",
      },
    ],
    "appointments.reject"
  );

const emailDecline = async ({ populated, appointment, previousSlotStart, assignedBy, actorId }) => {
  if (!populated?.resident?.email) return;

  const doctorLabel = await resolveDoctorLabel(assignedBy ?? actorId);
  const baseDetails = previousSlotStart
    ? formatAppointmentDetails(previousSlotStart, doctorLabel, null)
    : { ...TBD_DETAILS, worker: doctorLabel || TBD_DETAILS.worker };

  sendScheduleEmail(
    sendAppointmentDeclinedEmail,
    populated.resident,
    {
      ...baseDetails,
      appointmentType: formatConsultationTypeLabel(appointment.consultationType),
      declineReason: appointment.declineReason,
    },
    "Declined email delivery failed"
  );
};

const announceDecline = async ({
  appointment,
  previousSlotStart,
  freedMissionScheduleId,
  assignedBy,
  actorId,
}) => {
  const appointmentTypeLabel = formatConsultationTypeLabel(appointment.consultationType);
  const timeLabel = formatSlotStartForNotification(previousSlotStart) || "Recent";

  await notifyDecline({ appointment, actorId, appointmentTypeLabel, timeLabel });

  const populated = await Appointment.findById(appointment._id)
    .populate("resident", "fullname email")
    .lean();

  await emailDecline({ populated, appointment, previousSlotStart, assignedBy, actorId });

  if (freedMissionScheduleId) {
    await reprocessMissionQueue(freedMissionScheduleId, {
      staffId: actorId,
      route: "appointments.reject",
      failureMessage: "Priority queue reprocess after decline failed",
    });
  }

  return populated;
};

module.exports = { announceDecline };
