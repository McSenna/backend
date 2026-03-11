"use strict";

const { transporter, hasCredentials } = require("./config");

const { ASSETS, buildAttachments } = require("./assets");

const {
  generateOTPEmailHTML,
  generateNotificationEmailHTML,
  generateWelcomeEmailHTML,
  generateAppointmentConfirmationHTML,
  generateAppointmentReminderHTML,
  generatePasswordResetHTML,
} = {
  ...require("./templates/otp"),
  ...require("./templates/notification"),
  ...require("./templates/welcome"),
  ...require("./templates/appointment"),
  ...require("./templates/passwordReset"),
};

const {
  sendOTPEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendAppointmentConfirmationEmail,
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
  transporter,
  
  ASSETS,
  buildAttachments,
  
  generateOTPEmailHTML,
  generateNotificationEmailHTML,
  generateWelcomeEmailHTML,
  generateAppointmentConfirmationHTML,
  generateAppointmentReminderHTML,
  generatePasswordResetHTML,
  
  sendOTPEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentReminderEmail,
  sendPasswordResetEmail,
};