"use strict";

const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");
const {
  appointmentStatusBadge,
  appointmentDetailsCard,
  appointmentInfoCard,
} = require("./appointmentCards");
const {
  appointmentReminderRow,
  appointmentReminderCard,
  rescheduleRowPartial,
} = require("./appointmentReminderCards");

const generateAppointmentConfirmationHTML = (fullname, { date, time, worker, location, appointmentType }) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Appointment Confirmed`,
      `Your appointment at <strong style="color:${C.textDark};">MaslogCare</strong> has been successfully scheduled. Please review the details below.`),
    appointmentInfoCard({ patientName: fullname, appointmentType, date, time, worker, location, statusKind: "confirmed" }),
    appointmentReminderRow(),     
    ignoreNoticePartial(),        
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Confirmed for ${firstName}</title>`)
    .replace(">Verification<", ">Appointment<");
};

const generateAppointmentReminderHTML = (fullname, { date, time, worker, location, appointmentType }) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Upcoming Appointment`,
      `This is a reminder of your upcoming appointment at <strong style="color:${C.textDark};">MaslogCare</strong>. We look forward to seeing you.`),
    appointmentReminderCard({ patientName: fullname, date, time, worker, location }),  
    rescheduleRowPartial(),       
    ignoreNoticePartial(),        
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Reminder for ${firstName}</title>`)
    .replace(">Verification<", ">Reminder<");
};

const generateAppointmentRescheduledHTML = (fullname, { date, time, worker, location, appointmentType }) => {
  const year = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial(
      "heroNotif",
      `Appointment Rescheduled`,
      `Your appointment at <strong style="color:${C.textDark};">MaslogCare</strong> has been rescheduled. Please review the updated details below.`
    ),
    appointmentInfoCard({
      patientName: fullname,
      appointmentType,
      date,
      time,
      worker,
      location,
      statusKind: "rescheduled",
    }),
    rescheduleRowPartial(),
    ignoreNoticePartial(),
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Rescheduled for ${firstName}</title>`)
    .replace(">Verification<", ">Appointment<");
};

const generateAppointmentDeclinedHTML = (fullname, { date, time, worker, location, appointmentType, declineReason }) => {
  const year = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial(
      "heroNotif",
      `Appointment Declined`,
      `Your appointment request at <strong style="color:${C.textDark};">MaslogCare</strong> has been declined.`
    ),
    appointmentInfoCard({
      patientName: fullname,
      appointmentType,
      date,
      time,
      worker,
      location,
      statusKind: "declined",
      declineReason: declineReason || "",
    }),
    ignoreNoticePartial(),
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Update for ${firstName}</title>`)
    .replace(">Verification<", ">Appointment<");
};

module.exports = {
  generateAppointmentConfirmationHTML,
  generateAppointmentReminderHTML,
  generateAppointmentRescheduledHTML,
  generateAppointmentDeclinedHTML,
};
