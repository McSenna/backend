"use strict";

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
