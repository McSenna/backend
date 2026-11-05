"use strict";

const logger = require("../../utils/logger");
const SENDER_NAME = "MaslogCare";

const getMailConfig = () => ({
  isProd: process.env.NODE_ENV === "production",
  enabled: process.env.EMAIL_ENABLED !== "false",
  provider: (process.env.EMAIL_PROVIDER || "brevo").toLowerCase(),
  apiKey: process.env.BREVO_API_KEY,
  senderEmail: process.env.BREVO_SENDER_EMAIL,
  senderName: SENDER_NAME,
});

const hasCredentials = () => {
  const config = getMailConfig();
  return Boolean(config.apiKey && config.senderEmail);
};

const isEmailEnabled = () => getMailConfig().enabled;

function maskEmail(email) {
  if (!email || typeof email !== "string") return "unknown";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

// Checks settings only. Whether Brevo accepts the key and sender shows on the first send.
const verifyTransport = () => {
  const config = getMailConfig();

  if (!config.enabled || config.provider === "mock") {
    logger.info("Mock email mode active. Nothing is sent to Brevo.");
    return;
  }

  const missing = [
    !config.apiKey && "BREVO_API_KEY",
    !config.senderEmail && "BREVO_SENDER_EMAIL",
  ].filter(Boolean);

  if (missing.length > 0) {
    logger.warn(`${missing.join(" and ")} missing. Outgoing emails will fail until configured.`);
    return;
  }

  logger.info("Brevo settings found. The sender address must be verified in Brevo.");
};

module.exports = {
  hasCredentials,
  isEmailEnabled,
  getMailConfig,
  verifyTransport,
  maskEmail,
};
