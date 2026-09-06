"use strict";
const { transporter, hasCredentials } = require("../config");
const {
  generateAppointmentConfirmationHTML,
  generateAppointmentReminderHTML,
  generateAppointmentRescheduledHTML,
  generateAppointmentDeclinedHTML,
} = require("../templates/appointmentTemplate");
const { buildAttachments } = require("../assets");

function safeString(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function getDoctorLabel(appointmentDetails) {
  return appointmentDetails?.doctor || appointmentDetails?.worker || "Medical mission team";
}

function getAppointmentType(appointmentDetails) {
  const t = appointmentDetails?.appointmentType;
  return safeString(t).trim();
}

const sendAppointmentConfirmationEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment confirmation to:", email);
    return;
  }
  const appointmentType = getAppointmentType(appointmentDetails);
  const doctor = getDoctorLabel(appointmentDetails);
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Your Appointment is Confirmed",
      html:        generateAppointmentConfirmationHTML(fullname, appointmentDetails),
      text:        `Hello ${fullname}, ${
        appointmentType ? `your ${appointmentType} appointment` : "your MaslogCare appointment"
      } has been confirmed.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nDoctor: ${doctor}\nLocation: ${appointmentDetails.location}\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment confirmation email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment confirmation email:", err);
    throw new Error(`Failed to send appointment confirmation email: ${err.message}`);
  }
};

const sendAppointmentRescheduledEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment reschedule to:", email);
    return;
  }
  const appointmentType = getAppointmentType(appointmentDetails);
  const doctor = getDoctorLabel(appointmentDetails);

  try {
    await transporter.sendMail({
      from: `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "MaslogCare – Appointment Rescheduled",
      html: generateAppointmentRescheduledHTML(fullname, appointmentDetails),
      text: `Hello ${fullname}, ${
        appointmentType ? `your ${appointmentType} appointment` : "your MaslogCare appointment"
      } has been rescheduled.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nDoctor: ${doctor}\nLocation: ${appointmentDetails.location}\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment rescheduled email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment rescheduled email:", err);
    throw new Error(`Failed to send appointment rescheduled email: ${err.message}`);
  }
};

const sendAppointmentDeclinedEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment declined email to:", email);
    return;
  }
  const appointmentType = getAppointmentType(appointmentDetails);
  const doctor = getDoctorLabel(appointmentDetails);

  try {
    await transporter.sendMail({
      from: `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "MaslogCare – Appointment Update",
      html: generateAppointmentDeclinedHTML(fullname, appointmentDetails),
      text: `Hello ${fullname}, ${
        appointmentType ? `your ${appointmentType} appointment request` : "your appointment request"
      } has been declined.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nDoctor: ${doctor}\nLocation: ${appointmentDetails.location}\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment declined email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment declined email:", err);
    throw new Error(`Failed to send appointment declined email: ${err.message}`);
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
  sendAppointmentRescheduledEmail,
  sendAppointmentDeclinedEmail,
  sendAppointmentReminderEmail,
};