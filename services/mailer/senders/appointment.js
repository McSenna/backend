"use strict";
const { transporter, hasCredentials } = require("../config");
const { generateAppointmentConfirmationHTML, generateAppointmentReminderHTML } = require("../templates/appointment");
const { buildAttachments } = require("../assets");

const sendAppointmentConfirmationEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment confirmation to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Your Appointment is Confirmed",
      html:        generateAppointmentConfirmationHTML(fullname, appointmentDetails),
      text:        `Hello ${fullname}, your MaslogCare appointment has been confirmed.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nHealth Worker: ${appointmentDetails.worker}\nLocation: ${appointmentDetails.location}\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment confirmation email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment confirmation email:", err);
    throw new Error(`Failed to send appointment confirmation email: ${err.message}`);
  }
};

const sendAppointmentReminderEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment reminder to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Reminder: Appointment Tomorrow",
      html:        generateAppointmentReminderHTML(fullname, appointmentDetails),
      text:        `Hello ${fullname}, this is a reminder of your upcoming MaslogCare appointment.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nHealth Worker: ${appointmentDetails.worker}\nLocation: ${appointmentDetails.location}\n\nPlease arrive 10 minutes early and bring your health booklet and valid ID.\nQuestions? Email help@maslogcare.ph`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment reminder email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment reminder email:", err);
    throw new Error(`Failed to send appointment reminder email: ${err.message}`);
  }
};

module.exports = {
  sendAppointmentConfirmationEmail,
  sendAppointmentReminderEmail,
};