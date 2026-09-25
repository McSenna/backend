"use strict";

const Notification = require("../../models/Notification");
const logger = require("../../utils/logger");
const { sendAppointmentConfirmationEmail } = require("../mailer");
const {
  formatAppointmentDetails,
  formatConsultationTypeLabel,
  formatSlotStartForNotification,
} = require("../appointment/notifications");

const warn = (message) => (error) => logger.warn(message, { errorMessage: error?.message ?? error });

const announceAutoConfirm = ({ appointment, updated, staffId, doctorLabel }) => {
  const resident = appointment?.resident;
  const appointmentTypeLabel = formatConsultationTypeLabel(appointment.consultationType);
  const details = {
    ...formatAppointmentDetails(updated.slotStart, doctorLabel, null),
    appointmentType: appointmentTypeLabel,
  };
  const timeLabel = formatSlotStartForNotification(updated.slotStart);

  void Notification.create({
    recipient: resident?._id ?? appointment.resident,
    appointment: updated._id,
    type: "appointment_confirmed",
    title: "Appointment confirmed",
    body: `Your ${appointmentTypeLabel} appointment is confirmed. Date: ${details.date}. Time: ${details.time}. Doctor: ${doctorLabel || "Medical mission team"}.`,
    time: timeLabel,
    tone: "success",
  }).catch(warn("Auto-confirm notification failed"));

  if (staffId) {
    void Notification.create({
      recipient: staffId,
      appointment: updated._id,
      type: "appointment_confirmed",
      title: "Appointment confirmed",
      body: `${resident?.fullname ? `${resident.fullname}'s` : "A patient's"} ${appointmentTypeLabel} appointment is confirmed.`,
      time: timeLabel,
      tone: "success",
    }).catch(warn("Auto-confirm staff notification failed"));
  }

  if (resident?.email) {
    void sendAppointmentConfirmationEmail(resident.email, resident.fullname, details).catch(
      warn("Auto-confirm email failed")
    );
  }
};

module.exports = { announceAutoConfirm };
