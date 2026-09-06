"use strict";

// Centralized transporter re-export for full backward compatibility
const {
  transporter,
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
} = require("./transporter");

module.exports = {
  transporter,
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
};