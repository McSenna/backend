"use strict";

// The inbox row shape, shared by GET /notifications and
// realtime/publishers/notifications.js.
const mapToNotificationItem = (n) => ({
  id: String(n._id),
  title: n.title,
  body: n.body,
  time: n.time ?? "",
  tone: n.tone,
  type: n.type ?? "system",
  isRead: Boolean(n.isRead),
  createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : null,
  appointmentId: n.appointment ? String(n.appointment) : null,
  announcementId: n.announcement ? String(n.announcement) : null,
});

module.exports = { mapToNotificationItem };
