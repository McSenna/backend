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
  }
}

// Brevo's message text can echo addresses, so it picks the category but is never
// copied into the error, which ends up in logs.
function classifyBrevoResponse(status, body, headers) {
  const providerCode = String(body?.code || "");
  const providerMessage = String(body?.message || "");
  const summary = `Brevo refused the email (HTTP ${status}${providerCode ? ` ${providerCode}` : ""})`;

  if (status === 429) {
    const error = new EmailServiceError(
      EmailErrorCode.RATE_LIMITED,
      summary,
      "Email service is receiving too many requests. Please wait a moment and try again.",
      429
    );
    const retryAfter = Number(headers?.get?.("x-sib-ratelimit-reset"));
    if (retryAfter > 0) error.details = { retryAfter };
    return error;
  }

  if (status === 402 || providerCode === "not_enough_credits") {
    return new EmailServiceError(
      EmailErrorCode.QUOTA_EXCEEDED,
      summary,
      "The verification email service is temporarily unavailable due to provider limits. Please try again later.",
      503
    );
  }

  if (providerCode === "account_under_validation" || /sender/i.test(providerMessage)) {
    return new EmailServiceError(
      EmailErrorCode.CONFIGURATION_ERROR,
      `${summary}: check the Brevo account and BREVO_SENDER_EMAIL`,
      "The email service is not properly configured. Please contact the system administrator.",
      500
    );
  }

  if (status === 401 || status === 403) {
    return new EmailServiceError(
      EmailErrorCode.AUTH_FAILED,
      summary,
      "Email service authentication failed. Please contact the administrator.",
      503
    );
  }

  if (status === 400 && providerCode === "invalid_parameter" && /email|recipient/i.test(providerMessage)) {
    return new EmailServiceError(
      EmailErrorCode.RECIPIENT_INVALID,
      summary,
      "The specified recipient email address could not be delivered to.",
      400
    );
  }

  return new EmailServiceError(
    EmailErrorCode.UNKNOWN_ERROR,
    summary,
    "Failed to send email. Please try again later.",
    status >= 500 ? 503 : 500
  );
}

function classifyBrevoFailure(err) {
  const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
  const reason = timedOut ? "timed out" : err?.cause?.code || err?.name || "network failure";
  return new EmailServiceError(
    EmailErrorCode.NETWORK_ERROR,
    `Could not reach Brevo (${reason})`,
    "Temporary connection problem with the email service. Please try again in a few moments.",
    503,
    err
  );
}

module.exports = {
  EmailErrorCode,
  EmailServiceError,
  classifyBrevoResponse,
  classifyBrevoFailure,
};
