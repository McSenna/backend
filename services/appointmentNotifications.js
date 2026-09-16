"use strict";

const Notification = require("../models/Notification");
const logger = require("../utils/logger");

const LOCALE = "en-PH";

const MAX_BODY_LENGTH = 1000;

function formatAppointmentDetails(slotStart, workerLabel, locationLabel) {
  const date = new Date(slotStart);
  return {
    date: date.toLocaleDateString(LOCALE, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    time: date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" }),
    worker: workerLabel || "Medical mission team",
    location: locationLabel || "Barangay health mission site",
  };
}

function formatConsultationTypeLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatSlotStartForNotification(slotStart) {
  if (!slotStart) return "";
  const date = new Date(slotStart);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(LOCALE, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateNotificationBody(text, maxLength = MAX_BODY_LENGTH) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function createNotifications(docs, context) {
  try {
    await Promise.all(docs.map((doc) => Notification.create(doc)));
  } catch (error) {
    logger.warn("Notification delivery failed", {
      route: context,
      errorName: error?.name,
      errorMessage: error?.message,
    });
  }
}

module.exports = {
  formatAppointmentDetails,
  formatConsultationTypeLabel,
  formatSlotStartForNotification,
  truncateNotificationBody,
  createNotifications,
};
