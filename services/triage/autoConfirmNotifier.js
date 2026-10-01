"use strict";

const Notification = require("../../models/Notification");
const logger = require("../../utils/logger");
const { sendAppointmentConfirmationEmail } = require("../mailer");
const { visitLabels } = require("../appointment/visitLabels");
const {
  formatAppointmentDetails,
  formatConsultationTypeLabel,
  formatSlotStartForNotification,
} = require("../appointment/notifications");

const warn = (message) => (error) => logger.warn(message, { errorMessage: error?.message ?? error });

const confirmedBody = ({ labels, appointmentTypeLabel, details, doctorLabel }) =>
  labels.weekly
    ? `Your ${appointmentTypeLabel} appointment is confirmed. Date: ${details.date}. Time: ${details.time}, assigned first come, first served.`
    : `Your ${appointmentTypeLabel} appointment is confirmed. Date: ${details.date}. Time: ${details.time}. Doctor: ${doctorLabel || "Medical mission team"}.`;

const announceAutoConfirm = ({ appointment, updated, staffId, doctorLabel }) => {
  const resident = appointment?.resident;
  const appointmentTypeLabel = formatConsultationTypeLabel(appointment.consultationType);
  const labels = visitLabels(updated, doctorLabel);
  const details = {
    ...formatAppointmentDetails(updated.slotStart, labels.worker, labels.location),
    appointmentType: appointmentTypeLabel,
    ...(labels.patientName ? { patientName: labels.patientName } : {}),
  };
  const timeLabel = formatSlotStartForNotification(updated.slotStart);

  void Notification.create({
    recipient: resident?._id ?? appointment.resident,
    appointment: updated._id,
    type: "appointment_confirmed",
    title: "Appointment confirmed",
    body: confirmedBody({ labels, appointmentTypeLabel, details, doctorLabel }),
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
