"use strict";

const { transporter, getMailConfig, maskEmail, hasCredentials, isEmailEnabled } = require("./transporter");
const { EmailServiceError, EmailErrorCode, classifySmtpError } = require("./errors");

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Core sendMail function with provider abstraction, error classification,
 * structured logging, and safe bounded retries for transient connection errors only.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text fallback
 * @param {Array} [options.attachments] - Array of attachments
 * @returns {Promise<Object>} Nodemailer info object
 */
async function sendMail(options) {
  const { to, subject, html, text, attachments } = options;
  const config = getMailConfig();
  const maskedTo = maskEmail(to);

  if (!isEmailEnabled()) {
    console.log(`[MAIL] Dev mock mode active: simulated send to ${maskedTo} [Subject: "${subject}"]`);
    return {
      messageId: `mock-${Date.now()}`,
      response: "250 Mock email accepted",
      mock: true,
    };
  }

  if (!hasCredentials() && config.provider !== "mock") {
    console.warn(`[MAIL] Missing email credentials; skipping real email to ${maskedTo}`);
    throw new EmailServiceError(
      EmailErrorCode.CONFIGURATION_ERROR,
      "Email credentials are not configured on the server",
      "The email service is not properly configured. Please contact the system administrator.",
      500
    );
  }

  const mailPayload = {
    from: config.formattedFrom,
    to,
    subject,
    html,
    text: text || "",
    attachments: attachments || [],
  };

  let lastError = null;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    attempt++;
    try {
      console.log(`[MAIL] Attempting delivery to ${maskedTo} (attempt ${attempt}/${MAX_RETRIES + 1})`);
      const info = await transporter.sendMail(mailPayload);
      console.log(`[MAIL] Delivery successful to ${maskedTo}: ${info.messageId || info.response}`);
      return info;
    } catch (rawError) {
      const classified = classifySmtpError(rawError);
      lastError = classified;

      console.error(`[MAIL] Delivery failed to ${maskedTo}: [${classified.code}] ${classified.message}`);

      // NEVER retry quota, authentication, or recipient errors
      if (!classified.isRetryable || attempt > MAX_RETRIES) {
        throw classified;
      }

      const backoffMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[MAIL] Retrying in ${backoffMs}ms after transient error...`);
      await delay(backoffMs);
    }
  }

  throw lastError;
}

module.exports = {
  sendMail,
  maskEmail,
  isEmailEnabled,
  hasCredentials,
};
