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

// Socket events always use the generic mapper above. Patient identifiers and
// health detail are added only by the authenticated inbox after fresh ownership.
async function presentProtectedNotifications(rows, recipientId) {
  const items = rows.map(mapToNotificationItem);
  const immunizationRows = rows.filter(row => row.immunizationBabyId);
  if (!immunizationRows.length) return items;
  const User = require("../../models/User");
  const Baby = require("../../models/Baby");
  const Reminder = require("../../models/ImmunizationReminder");
  const user = await User.findOne({
    _id: recipientId, role: "resident", verified: true, status: { $in: ["approved", "active"] },
    verificationMethod: { $in: ["master_list", "admin_review"] },
    masterResidentId: { $type: "string", $ne: "" },
  }).lean();
  if (!user) return items;
  const babies = await Baby.find({
    _id: { $in: immunizationRows.map(row => row.immunizationBabyId) },
    motherMasterResidentId: user.masterResidentId,
  }).select("_id").lean();
  const allowed = new Set(babies.map(baby => String(baby._id)));
  const reminders = await Reminder.find({
    _id: { $in: immunizationRows.map(row => row.immunizationReminderId).filter(Boolean) },
    recipient: recipientId, status: "delivered",
  }).select("_id").lean();
  const live = new Set(reminders.map(reminder => String(reminder._id)));
  rows.forEach((row, index) => {
    if (String(row.recipient) === String(recipientId) && allowed.has(String(row.immunizationBabyId)) && live.has(String(row.immunizationReminderId))) {
      items[index].immunizationBabyId = String(row.immunizationBabyId);
      items[index].immunizationDetail = row.immunizationDetail;
    }
  });
  return items;
}
module.exports = { mapToNotificationItem, presentProtectedNotifications };
