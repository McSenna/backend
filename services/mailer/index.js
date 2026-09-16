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
  generatePasswordChangedHTML,
} = {
  ...require("./templates/otpTemplate"),
  ...require("./templates/notificationTemplate"),
  ...require("./templates/welcomeTemplate"),
  ...require("./templates/appointmentTemplate"),
  ...require("./templates/passwordResetTemplate"),
  ...require("./templates/passwordChangedTemplate"),
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
  sendPasswordResetCodeEmail,
  sendPasswordChangedEmail,
} = {
  ...require("./senders/otp"),
  ...require("./senders/notification"),
  ...require("./senders/welcome"),
  ...require("./senders/appointment"),
  ...require("./senders/passwordReset"),
};

module.exports = {
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
  generatePasswordChangedHTML,

  sendOTPEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduledEmail,
  sendAppointmentDeclinedEmail,
  sendAppointmentReminderEmail,
  sendPasswordResetEmail,
  sendPasswordResetCodeEmail,
  sendPasswordChangedEmail,
};
