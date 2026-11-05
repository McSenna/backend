"use strict";
const logger = require("../../../utils/logger");
const { sendMail, hasCredentials, maskEmail } = require("../mailService");

const CONTACT_LINE = "Questions? Email help@maslogcare.ph or visit your nearest Maslog Barangay Health Center.";
const BEFORE_YOU_COME = "Before you come: arrive 10 minutes early and bring your health booklet and a valid ID.";
const CANT_MAKE_IT = "Can't make it? Email help@maslogcare.ph.";

const describeVisit = (details, noun) => {
  const type = String(details?.appointmentType ?? "").trim();
  return type ? `Your ${type} ${noun}` : `Your MaslogCare ${noun}`;
};

const detailLines = (fullname, details, workerLabel = "Doctor") =>
  [
    ["Patient", details.patientName || fullname],
    ["Appointment type", details.appointmentType],
    ["Date", details.date],
    ["Time", details.time],
    [workerLabel, details.doctor || details.worker || "Medical mission team"],
    ["Location", details.location],
    ["Reason", details.declineReason],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

const sendAppointmentEmail = async (label, email, subject, lines) => {
  if (!hasCredentials()) {
    logger.warn(`Email settings missing; ${label} email not sent`, { to: maskEmail(email) });
    return;
  }
  try {
    await sendMail({ to: email, subject, text: lines.join("\n") });
  } catch (err) {
    throw new Error(`Failed to send ${label} email: ${err.message}`);
  }
};

const sendAppointmentConfirmationEmail = (email, fullname = "User", details = {}) =>
  sendAppointmentEmail("appointment confirmation", email, "MaslogCare – Your Appointment is Confirmed", [
    `Hello ${fullname},`,
    "",
    `${describeVisit(details, "appointment")} is confirmed.`,
    "",
    ...detailLines(fullname, details),
    "",
    BEFORE_YOU_COME,
    "",
    CONTACT_LINE,
  ]);

const sendAppointmentRescheduledEmail = (email, fullname = "User", details = {}) =>
  sendAppointmentEmail("appointment rescheduled", email, "MaslogCare – Appointment Rescheduled", [
    `Hello ${fullname},`,
    "",
    `${describeVisit(details, "appointment")} has been rescheduled. Please review the updated details below.`,
    "",
    ...detailLines(fullname, details),
    "",
    CANT_MAKE_IT,
    "",
    CONTACT_LINE,
  ]);

const sendAppointmentDeclinedEmail = (email, fullname = "User", details = {}) =>
  sendAppointmentEmail("appointment declined", email, "MaslogCare – Appointment Update", [
    `Hello ${fullname},`,
    "",
    `${describeVisit(details, "appointment request")} has been declined.`,
    "",
    ...detailLines(fullname, details),
    "",
    CONTACT_LINE,
  ]);

const sendAppointmentReminderEmail = (email, fullname = "User", details = {}) =>
  sendAppointmentEmail("appointment reminder", email, "MaslogCare – Reminder: Appointment Tomorrow", [
    `Hello ${fullname},`,
    "",
    "This is a reminder that your MaslogCare appointment is tomorrow.",
    "",
    ...detailLines(fullname, details, "Health worker"),
    "",
    BEFORE_YOU_COME,
    "",
    CANT_MAKE_IT,
    "",
    CONTACT_LINE,
  ]);

module.exports = {
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduledEmail,
  sendAppointmentDeclinedEmail,
  sendAppointmentReminderEmail,
};
