"use strict";

const Appointment = require("../../models/Appointment");

const FALLBACK_BODY = "Open MaslogCare to view your notification.";
const APPOINTMENT_BODIES = Object.freeze({
  appointment_queued: "Your appointment request is queued. We will notify you when a date and time are assigned.",
  appointment_cancelled: "Your appointment has been cancelled.",
  appointment_declined: "Your appointment request has been declined.",
  appointment_completed: "Your appointment has been completed.",
  appointment_processing: "Your appointment is now being processed.",
});
const SCHEDULE_PREFIXES = Object.freeze({
  appointment_confirmed: "Your appointment is confirmed",
  appointment_rescheduled: "Your appointment has been rescheduled",
});

// Bound UTF-8 payload size without cutting a Unicode character in half.
const announcementBody = (body) => {
  const characters = Array.from(typeof body === "string" ? body.trim() : "");
  if (!characters.length) return "Open MaslogCare to view the announcement.";
  return characters.length > 500 ? `${characters.slice(0, 497).join("")}...` : characters.join("");
};

const scheduledBody = async (notification, prefix) => {
  // Inbox bodies can contain names, visit reasons and clinical notes. Read only
  // the recipient's own schedule instead of forwarding that private text.
  const appointment = notification.appointment && await Appointment.findOne({
    _id: notification.appointment, resident: notification.recipient,
  }).select("slotStart").lean();
  const date = appointment?.slotStart && new Date(appointment.slotStart);
  if (!date || Number.isNaN(date.getTime())) return `${prefix}. Open MaslogCare for details.`;
  const options = { timeZone: "Asia/Manila" };
  const day = date.toLocaleDateString("en-US", { ...options, year: "numeric", month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-US", { ...options, hour: "numeric", minute: "2-digit" });
  const preposition = notification.type === "appointment_rescheduled" ? "to" : "for";
  return `${prefix} ${preposition} ${day} at ${time} (Asia/Manila).`;
};

const buildPushContent = async (notification) => {
  if (notification.type === "announcement") {
    return { title: "Announcement", body: announcementBody(notification.body) };
  }
  if (notification.type === "appointment" || notification.type?.startsWith("appointment_")) {
    const prefix = SCHEDULE_PREFIXES[notification.type];
    const body = prefix
      ? await scheduledBody(notification, prefix)
      : APPOINTMENT_BODIES[notification.type] || "You have an appointment update.";
    return { title: "Appointment", body };
  }
  return { title: "MaslogCare", body: FALLBACK_BODY };
};

module.exports = { buildPushContent };
