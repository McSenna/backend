"use strict";

const logger = require("../../utils/logger");
const { getMailConfig, maskEmail, hasCredentials, isEmailEnabled } = require("./config");
const { EmailServiceError, EmailErrorCode, classifyBrevoResponse, classifyBrevoFailure } = require("./errors");

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 10000;

// Sends one plain text email through Brevo. Success means Brevo accepted the
// message for sending, not that it reached the inbox.
// There is one attempt only: after a timeout Brevo may already have accepted the
// message, so an automatic retry could send it twice.
async function sendMail({ to, subject, text }) {
  const config = getMailConfig();
  const maskedTo = maskEmail(to);

  if (!config.enabled || config.provider === "mock") {
    logger.info("Mock mode active: simulated email send", { to: maskedTo, subject });
    return { messageId: `mock-${Date.now()}`, mock: true };
  }

  if (!hasCredentials()) {
    logger.warn("BREVO_API_KEY or BREVO_SENDER_EMAIL is missing; email not sent", { to: maskedTo });
    throw new EmailServiceError(
      EmailErrorCode.CONFIGURATION_ERROR,
      "BREVO_API_KEY or BREVO_SENDER_EMAIL is not configured on the server",
      "The email service is not properly configured. Please contact the system administrator.",
      500
    );
  }

  let response;
  try {
    response = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify({
        sender: { name: config.senderName, email: config.senderEmail },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (rawError) {
    const failure = classifyBrevoFailure(rawError);
    logger.error("Email send failed", { to: maskedTo, code: failure.code, reason: failure.message });
    throw failure;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const refusal = classifyBrevoResponse(response.status, body, response.headers);
    logger.error("Email send failed", { to: maskedTo, code: refusal.code, reason: refusal.message });
    throw refusal;
  }

  logger.info("Email accepted by Brevo", { to: maskedTo, messageId: body.messageId });
  return { messageId: body.messageId };
}

module.exports = {
  sendMail,
  maskEmail,
  isEmailEnabled,
  hasCredentials,
};
