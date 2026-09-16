"use strict";

const EmailErrorCode = Object.freeze({
  QUOTA_EXCEEDED: "EMAIL_QUOTA_EXCEEDED",
  AUTH_FAILED: "EMAIL_AUTH_FAILED",
  RATE_LIMITED: "EMAIL_RATE_LIMITED",
  NETWORK_ERROR: "EMAIL_NETWORK_ERROR",
  RECIPIENT_INVALID: "EMAIL_RECIPIENT_INVALID",
  CONFIGURATION_ERROR: "EMAIL_CONFIGURATION_ERROR",
  SERVICE_DISABLED: "EMAIL_SERVICE_DISABLED",
  UNKNOWN_ERROR: "EMAIL_UNKNOWN_ERROR",
});

class EmailServiceError extends Error {
  constructor(code, message, userMessage, httpStatus = 503, originalError = null) {
    super(message);
    this.name = "EmailServiceError";
    this.code = code;
    this.userMessage = userMessage || "The verification email service is temporarily unavailable. Please try again later.";
    this.httpStatus = httpStatus;
    this.originalError = originalError;
    this.isRetryable = [
      EmailErrorCode.NETWORK_ERROR,
      EmailErrorCode.RATE_LIMITED,
    ].includes(code);
  }
}

function classifySmtpError(err) {
  if (err instanceof EmailServiceError) {
    return err;
  }

  const rawMsg = String(err?.message || "").toLowerCase();
  const rawResponse = String(err?.response || "").toLowerCase();
  const responseCode = Number(err?.responseCode || 0);
  const sysCode = String(err?.code || "").toUpperCase();

  if (
    responseCode === 550 ||
    rawResponse.includes("daily user sending limit exceeded") ||
    rawMsg.includes("daily user sending limit exceeded") ||
    rawResponse.includes("quota exceeded") ||
    rawMsg.includes("quota exceeded")
  ) {
    return new EmailServiceError(
      EmailErrorCode.QUOTA_EXCEEDED,
      `Provider daily sending quota exceeded: ${err.message}`,
      "The verification email service is temporarily unavailable due to provider limits. Please try again later.",
      503,
      err
    );
  }

  if (
    responseCode === 535 ||
    rawResponse.includes("authentication failed") ||
    rawMsg.includes("authentication failed") ||
    rawResponse.includes("bad credentials") ||
    rawMsg.includes("bad credentials") ||
    sysCode === "EAUTH"
  ) {
    return new EmailServiceError(
      EmailErrorCode.AUTH_FAILED,
      `SMTP authentication failed: ${err.message}`,
      "Email service authentication failed. Please contact the administrator.",
      503,
      err
    );
  }

  if (
    responseCode === 421 ||
    responseCode === 429 ||
    rawMsg.includes("too many connections") ||
    rawResponse.includes("too many connections") ||
    rawMsg.includes("rate limit")
  ) {
    return new EmailServiceError(
      EmailErrorCode.RATE_LIMITED,
      `SMTP rate limit exceeded: ${err.message}`,
      "Email service is receiving too many requests. Please wait a moment and try again.",
      429,
      err
    );
  }

  const networkCodes = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ESOCKETTIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EENVELOPE"];
  if (
    networkCodes.includes(sysCode) ||
    rawMsg.includes("connection closed") ||
    rawMsg.includes("timed out")
  ) {
    return new EmailServiceError(
      EmailErrorCode.NETWORK_ERROR,
      `SMTP connection failure (${sysCode}): ${err.message}`,
      "Temporary connection problem with the email service. Please try again in a few moments.",
      503,
      err
    );
  }

  if (
    responseCode === 551 ||
    responseCode === 553 ||
    rawMsg.includes("recipient rejected") ||
    rawMsg.includes("no such user") ||
    rawResponse.includes("invalid recipient")
  ) {
    return new EmailServiceError(
      EmailErrorCode.RECIPIENT_INVALID,
      `Destination recipient rejected: ${err.message}`,
      "The specified recipient email address could not be delivered to.",
      400,
      err
    );
  }

  return new EmailServiceError(
    EmailErrorCode.UNKNOWN_ERROR,
    `Unclassified email error: ${err.message}`,
    "Failed to send email. Please try again later.",
    500,
    err
  );
}

module.exports = {
  EmailErrorCode,
  EmailServiceError,
  classifySmtpError,
};
