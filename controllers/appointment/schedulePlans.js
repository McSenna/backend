"use strict";

const {
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduledEmail,
} = require("../../services/mailer");

const doctorOrTeam = (doctorLabel) => doctorLabel || "Medical mission team";

const patientPossessive = (residentName) =>
  residentName ? `${residentName}'s` : "A patient's";

const assignPlan = ({ missionScheduleId, categoryKey }) => ({
  route: "appointments.assign",
  notification: {
    type: "appointment_confirmed",
    title: "Appointment confirmed",
    tone: "success",
    residentBody: ({ appointmentTypeLabel, details, doctorLabel }) =>
      `Your ${appointmentTypeLabel} appointment is confirmed. Date: ${details.date}. Time: ${details.time}. Doctor: ${doctorOrTeam(doctorLabel)}.`,
    actorBody: ({ appointmentTypeLabel, residentName }) =>
      `${patientPossessive(residentName)} ${appointmentTypeLabel} appointment is confirmed.`,
  },
  sendEmail: sendAppointmentConfirmationEmail,
  emailFailureMessage: "Confirmation email delivery failed",
  queueFailureMessage: "Priority queue reprocess after assign failed",
  log: {
    action: "APPOINTMENT_APPROVED",
    description: "Medical staff approved and scheduled an appointment",
    metadata: { missionScheduleId, categoryKey },
  },
});

const reassignPlan = ({ missionScheduleId, categoryKey }) => ({
  route: "appointments.reassign",
  notification: {
    type: "appointment_rescheduled",
    title: "Appointment rescheduled",
    tone: "warning",
    residentBody: ({ appointmentTypeLabel, details, doctorLabel }) =>
      `Your ${appointmentTypeLabel} appointment has been rescheduled. Date: ${details.date}. Time: ${details.time}. Doctor: ${doctorOrTeam(doctorLabel)}.`,
    actorBody: ({ appointmentTypeLabel, residentName }) =>
      `${patientPossessive(residentName)} ${appointmentTypeLabel} appointment is rescheduled.`,
  },
  sendEmail: sendAppointmentRescheduledEmail,
  emailFailureMessage: "Reschedule email delivery failed",
  queueFailureMessage: "Priority queue reprocess after reassign failed",
  log: {
    action: "APPOINTMENT_RESCHEDULED",
    description: "Medical staff rescheduled an appointment",
    metadata: { missionScheduleId, categoryKey },
  },
});

module.exports = { assignPlan, reassignPlan };
