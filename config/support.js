"use strict";

const { RESIDENCY } = require("./residency");

const SUPPORT_CATEGORIES = Object.freeze([
  "account_registration",
  "email_otp_verification",
  "account_approval",
  "appointment_concern",
  "reschedule_issue",
  "appointment_cancellation",
  "medical_information",
  "notification_issue",
  "incorrect_personal_information",
  "technical_problem",
  "privacy_security",
  "other",
]);

const SUPPORT_STATUSES = Object.freeze(["open", "in_review", "awaiting_user", "resolved", "closed"]);

const SUPPORT_ROLES = Object.freeze(["resident", "doctor", "bhw", "midwife", "admin"]);

const SUPPORT_LIMITS = Object.freeze({
  subjectMin: 5,
  subjectMax: 120,
  descriptionMin: 20,
  descriptionMax: 2000,
  messageMax: 2000,
  maxAttachments: 3,
  maxAttachmentBytes: 5 * 1024 * 1024,
  allowedMimes: Object.freeze(["image/jpeg", "image/png", "application/pdf"]),
  defaultPageSize: 10,
  maxPageSize: 50,
});

const SUPPORT_CONTACT = Object.freeze({
  name: process.env.SUPPORT_CONTACT_NAME || `Barangay ${RESIDENCY.barangay} Health Center`,
  location:
    process.env.SUPPORT_CONTACT_LOCATION ||
    `Barangay ${RESIDENCY.barangay}, ${RESIDENCY.cityMunicipality}, ${RESIDENCY.province}`,
  contactNumber: process.env.SUPPORT_CONTACT_NUMBER || "Not yet available",
  email: process.env.SUPPORT_CONTACT_EMAIL || process.env.EMAIL_USER || "Not yet available",
  officeHours: Object.freeze([
    { days: "Monday – Friday", hours: process.env.SUPPORT_OFFICE_HOURS || "8:00 AM – 5:00 PM" },
  ]),
  responseTime: process.env.SUPPORT_RESPONSE_TIME || "We usually respond within 1–2 business days.",
});

module.exports = {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  SUPPORT_ROLES,
  SUPPORT_LIMITS,
  SUPPORT_CONTACT,
};
