"use strict";
const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");

const appointmentDetailsCard = ({ patientName, date, time, worker, location }) => `
<table cellpadding="0" cellspacing="0" width="100%" role="presentation"
  style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.06);">
  <tr>
    <td style="padding:20px 20px 6px;">
      ${[
        { label: "&#128100; Patient",       value: patientName },
        { label: "&#128197; Date",           value: date        },
        { label: "&#128336; Time",           value: time        },
        { label: "&#129654; Health Worker",  value: worker      },
        { label: "&#127968; Location",       value: location    },
      ].map(({ label, value }) => `
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom:12px;">
        <tr>
          <td width="130" valign="top">
            <span style="font-size:11px;font-weight:700;color:${C.textSubtle};font-family:${fonts.sans};">${label}</span>
          </td>
          <td valign="top">
            <span style="font-size:12.5px;font-weight:600;color:${C.textDark};font-family:${fonts.sans};">${value}</span>
          </td>
        </tr>
      </table>`).join("")}
    </td>
  </tr>
  <tr>
    <td style="padding:0 20px 18px;">
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
        style="background:${C.sageBg};border:1px solid ${C.sageBorder};border-radius:10px;">
        <tr>
          <td style="padding:10px 16px;text-align:center;">
            <span style="font-size:12px;font-weight:700;color:${C.sageText};font-family:${fonts.sans};">&#9989; Your appointment is confirmed</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

const appointmentInfoCard = ({ patientName, date, time, worker, location }) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Appointment Details</p>
    ${appointmentDetailsCard({ patientName, date, time, worker, location })}
  </td>
</tr>`;

const appointmentReminderRow = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.skyBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#128276;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Before You Come</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Arrive <strong>10 minutes early</strong> and bring your health booklet and a valid ID.
              Need changes? Email <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">help@maslogcare.ph</a>.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

const appointmentReminderCard = ({ patientName, date, time, worker, location }) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.goldBg};border:1.5px solid ${C.goldBorder};border-radius:10px;margin-bottom:14px;">
      <tr>
          <td style="padding:10px 16px;text-align:center;">
            <span style="font-size:12px;font-weight:700;color:${C.goldText};font-family:${fonts.sans};">&#9200; Your appointment is tomorrow</span>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Appointment Details</p>
    ${appointmentDetailsCard({ patientName, date, time, worker, location })}
  </td>
</tr>`;

const rescheduleRowPartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.goldBorder};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.goldBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#9200;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${C.goldText};font-family:${fonts.sans};">Can&rsquo;t make it?</p>
            <table cellpadding="0" cellspacing="0" role="presentation"><tr>
              <td style="padding-right:8px;">
                <a href="#" style="display:inline-block;background:${C.midnight};color:${C.white};font-family:${C.fonts.sans};font-size:11.5px;font-weight:700;padding:8px 18px;border-radius:50px;text-decoration:none;">Confirm Attendance</a>
              </td>
              <td>
                <a href="mailto:help@maslogcare.ph" style="display:inline-block;border:1.5px solid ${C.midnight};color:${C.midnight};font-size:11.5px;font-weight:700;font-family:${C.fonts.sans};text-decoration:none;padding:7px 16px;border-radius:50px;">Request Reschedule</a>
              </td>
            </tr></table>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

const generateAppointmentConfirmationHTML = (fullname, { date, time, worker, location }) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Appointment Confirmed`,
      `Your appointment at <strong style="color:${C.textDark};">MaslogCare</strong> has been successfully scheduled. Please review the details below.`),
    appointmentInfoCard({ patientName: fullname, date, time, worker, location }),  
    appointmentReminderRow(),     
    ignoreNoticePartial(),        
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Confirmed for ${firstName}</title>`)
    .replace(">Verification<", ">Appointment<");
};

const generateAppointmentReminderHTML = (fullname, { date, time, worker, location }) => {
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

module.exports = {
  generateAppointmentConfirmationHTML,
  generateAppointmentReminderHTML,
};