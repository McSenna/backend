"use strict";
const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");

const NOTIFICATION_CARDS = [
  {
    emoji: "&#128197;", iconBg: C.skyBg,  iconBorder: C.skyBorder,
    title: "Appointment Reminder",
    desc:  "Your health center appointment is scheduled for tomorrow at 9:00 AM. Please bring your health booklet and valid ID.",
    tag: "&#128205; Tomorrow, 9:00 AM", tagBg: C.skyBg, tagBorder: C.skyBorder, tagColor: C.midnight,
  },
  {
    emoji: "&#128137;", iconBg: C.sageBg, iconBorder: C.sageBorder,
    title: "Vaccination Program",
    desc:  "Free flu vaccination available this week at the Barangay Health Center. Walk-ins welcome — no appointment needed.",
    tag: "&#128197; Until Mar 31", tagBg: C.sageBg, tagBorder: C.sageBorder, tagColor: C.sageText,
  },
  {
    emoji: "&#127775;", iconBg: C.goldBg, iconBorder: C.goldBorder,
    title: "Community Announcement",
    desc:  "New telehealth consultation services are now available for all registered MaslogCare members in the barangay.",
    tag: "&#10024; New Service", tagBg: C.goldBg, tagBorder: C.goldBorder, tagColor: C.goldText,
  },
];

const notificationBodyPartial = () => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Your Updates</p>
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.05);">
      ${NOTIFICATION_CARDS.slice(0,2).map((card, i) => `
      <tr><td style="padding:16px 18px;${i > 0 ? `border-top:1px solid ${C.mistBorder};` : ""}">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:12px;">
            <div style="width:40px;height:40px;background:${card.iconBg};border:1.5px solid ${card.iconBorder};border-radius:10px;text-align:center;line-height:40px;font-size:19px;">${card.emoji}</div>
          </td>
          <td valign="top">
            <p style="margin:0 0 3px;font-size:12.5px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">${card.title}</p>
            <p style="margin:0 0 6px;font-size:11.5px;color:${C.textLight};line-height:1.55;font-family:${fonts.sans};">${card.desc}</p>
            <span style="display:inline-block;font-size:10px;font-weight:700;color:${card.tagColor};background:${card.tagBg};border:1px solid ${card.tagBorder};padding:2px 9px;border-radius:100px;font-family:${fonts.sans};">${card.tag}</span>
          </td>
        </tr></table>
      </td></tr>`).join("")}
      <tr><td style="padding:12px 18px;border-top:1px solid ${C.mistBorder};text-align:center;">
        <a href="#" style="display:inline-block;background:${C.midnight};color:${C.white};font-family:${C.fonts.sans};font-size:12px;font-weight:700;padding:10px 28px;border-radius:100px;text-decoration:none;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(16,46,74,0.26);">View Health Portal &#8594;</a>
      </td></tr>
    </table>
  </td>
</tr>`;

const notificationCtaPartial = () => `
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
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Stay Up to Date</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Log in to your patient portal to view complete health records, manage appointments, and access all services.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

const generateNotificationEmailHTML = (fullname) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Health Notification`,
      `You have received a new healthcare update from MaslogCare. Please review the details below at your convenience.`),
    notificationBodyPartial(),     
    notificationCtaPartial(),     
    ignoreNoticePartial(),        
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Health Notification for ${firstName}</title>`)
    .replace(">Verification<", ">Notification<");
};

module.exports = {
  generateNotificationEmailHTML,
};