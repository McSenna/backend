"use strict";
const { transporter, hasCredentials } = require("../config");
const { generateNotificationEmailHTML } = require("../templates/notification");
const { buildAttachments } = require("../assets");

const sendNotificationEmail = async (email, fullname = "User") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send notification email to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Health Notification",
      html:        generateNotificationEmailHTML(fullname),
      text:        `You have received a new healthcare update from MaslogCare. Please log in to your patient portal to view your health records and updates.\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Notification email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending notification email:", err);
  }
};

module.exports = {
  sendNotificationEmail,
};