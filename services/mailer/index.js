"use strict";

const {
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
} = require("./config");

const { sendMail } = require("./mailService");
const { EmailServiceError, EmailErrorCode, classifyBrevoResponse, classifyBrevoFailure } = require("./errors");

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
  maskEmailAddress,
} = {
  ...require("./senders/otp"),
  ...require("./senders/notification"),
  ...require("./senders/welcome"),
  ...require("./senders/appointment"),
  ...require("./senders/passwordReset"),
};

module.exports = {
  sendMail,
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
  maskEmailAddress,
  EmailServiceError,
  EmailErrorCode,
  classifyBrevoResponse,
  classifyBrevoFailure,

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
