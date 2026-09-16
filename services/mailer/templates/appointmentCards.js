"use strict";

const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");

const appointmentStatusBadge = (statusKind) => {
  const kind = statusKind || "confirmed";

  if (kind === "rescheduled") {
    return `
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
        style="background:${C.goldBg};border:1px solid ${C.goldBorder};border-radius:10px;">
        <tr>
          <td style="padding:10px 16px;text-align:center;">
            <span style="font-size:12px;font-weight:700;color:${C.goldText};font-family:${fonts.sans};">&#9200; Your appointment has been rescheduled</span>
          </td>
        </tr>
      </table>
    `;
  }

  if (kind === "declined") {
    return `
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
        style="background:${C.mist};border:1px solid ${C.mistBorder};border-radius:10px;">
        <tr>
          <td style="padding:10px 16px;text-align:center;">
            <span style="font-size:12px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">&#128197; Your appointment request was declined</span>
          </td>
        </tr>
      </table>
    `;
  }

  return `
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.sageBg};border:1px solid ${C.sageBorder};border-radius:10px;">
      <tr>
        <td style="padding:10px 16px;text-align:center;">
          <span style="font-size:12px;font-weight:700;color:${C.sageText};font-family:${fonts.sans};">&#9989; Your appointment is confirmed</span>
        </td>
      </tr>
    </table>
  `;
};

const appointmentDetailsCard = ({
  patientName,
  appointmentType,
  date,
  time,
  worker,
  location,
  declineReason,
  statusKind = "confirmed",
}) => `
<table cellpadding="0" cellspacing="0" width="100%" role="presentation"
  style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.06);">
  <tr>
    <td style="padding:20px 20px 6px;">
      ${[
        { label: "&#128100; Patient", value: patientName },
        appointmentType ? { label: "&#128336; Appointment Type", value: appointmentType } : null,
        { label: "&#128197; Date", value: date },
        { label: "&#128336; Time", value: time },
        { label: "&#129654; Doctor", value: worker },
        { label: "&#127968; Location", value: location },
        statusKind === "declined" && declineReason
          ? { label: "&#128221; Reason", value: declineReason }
          : null,
      ]
        .filter(Boolean)
        .map(({ label, value }) => `
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
      ${appointmentStatusBadge(statusKind)}
    </td>
  </tr>
</table>`;

const appointmentInfoCard = ({ patientName, appointmentType, date, time, worker, location, statusKind, declineReason }) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Appointment Details</p>
    ${appointmentDetailsCard({
      patientName,
      appointmentType,
      date,
      time,
      worker,
      location,
      statusKind,
      declineReason,
    })}
  </td>
</tr>`;

module.exports = { appointmentStatusBadge, appointmentDetailsCard, appointmentInfoCard };
