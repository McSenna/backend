"use strict";

const {
  transporter,
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
} = require("./transporter");

const { sendMail } = require("./mailService");
const { EmailServiceError, EmailErrorCode, classifySmtpError } = require("./errors");
const { ASSETS, buildAttachments } = require("./assets");

const {
  generateOTPEmailHTML,
  generateNotificationEmailHTML,
  generateWelcomeEmailHTML,
  generateAppointmentConfirmationHTML,
  generateAppointmentRescheduledHTML,
  generateAppointmentDeclinedHTML,
  generateAppointmentReminderHTML,
  generatePasswordResetHTML,
} = {
  ...require("./templates/otpTemplate"),
  ...require("./templates/notificationTemplate"),
  ...require("./templates/welcomeTemplate"),
  ...require("./templates/appointmentTemplate"),
  ...require("./templates/passwordResetTemplate"),
};

const {
  sendOTPEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduledEmail,
  sendAppointmentDeclinedEmail,
  sendAppointmentReminderEmail,
  sendPasswordResetEmail,
} = {
  ...require("./senders/otp"),
  ...require("./senders/notification"),
  ...require("./senders/welcome"),
  ...require("./senders/appointment"),
  ...require("./senders/passwordReset"),
};

module.exports = {
  // Transporter & core mail service
  transporter,
  sendMail,
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
  EmailServiceError,
  EmailErrorCode,
  classifySmtpError,

  // Assets & templates
  ASSETS,
  buildAttachments,
  generateOTPEmailHTML,
  generateNotificationEmailHTML,
  generateWelcomeEmailHTML,
  generateAppointmentConfirmationHTML,
  generateAppointmentRescheduledHTML,
  generateAppointmentDeclinedHTML,
  generateAppointmentReminderHTML,
  generatePasswordResetHTML,

  // Senders
  sendOTPEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduledEmail,
  sendAppointmentDeclinedEmail,
  sendAppointmentReminderEmail,
  sendPasswordResetEmail,
};