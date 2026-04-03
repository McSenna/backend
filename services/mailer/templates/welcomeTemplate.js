"use strict";
const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");
const { cidImg } = require("../assets");

const WELCOME_FEATURES = [
  { iconKey: "calendar",  title: "Book Appointments",    desc: "Schedule barangay health visits easily" },
  { iconKey: "megaphone", title: "Health Announcements", desc: "Stay updated on programs & alerts"       },
  { iconKey: "records",   title: "Medical Records",      desc: "View & manage your health history"       },
  { iconKey: "health",    title: "Health Programs",      desc: "Access community wellness programs"      },
];

const featureCard = ({ iconKey, title, desc }) => `
<table cellpadding="0" cellspacing="0" width="236" role="presentation"
  style="width:236px;background:${C.white};border:1px solid ${C.mistBorder};border-top:3px solid ${C.midnight};border-radius:12px;box-shadow:0 2px 8px rgba(16,46,74,0.06);">
  <tr>
    <td width="236" style="padding:16px 10px;text-align:center;">
      <div style="margin:0 auto 9px;width:42px;height:42px;background:${C.mist};border-radius:10px;text-align:center;line-height:42px;">
        ${cidImg(iconKey, 38, 38, title, "margin:0 auto;")}
      </div>
      <p style="margin:0 0 3px;font-size:11px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};line-height:1.3;">${title}</p>
      <p style="margin:0;font-size:10px;color:${C.textLight};line-height:1.45;font-family:${fonts.sans};">${desc}</p>
    </td>
  </tr>
</table>`;

const welcomeGridPartial = () => {
  const [f1, f2, f3, f4] = WELCOME_FEATURES;
  return `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};text-align:center;">What You Can Do</p>
    <table cellpadding="0" cellspacing="0" width="488" role="presentation" style="width:488px;">
      <tr>
        <td width="238" valign="top" style="width:238px;padding-bottom:8px;">${featureCard(f1)}</td>
        <td width="12"  style="width:12px;"></td>
        <td width="238" valign="top" style="width:238px;padding-bottom:8px;">${featureCard(f2)}</td>
      </tr>
      <tr>
        <td width="238" valign="top" style="width:238px;">${featureCard(f3)}</td>
        <td width="12"  style="width:12px;"></td>
        <td width="238" valign="top" style="width:238px;">${featureCard(f4)}</td>
      </tr>
    </table>
  </td>
</tr>`;
};

const welcomeCtaPartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.sageBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#9989;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">You&rsquo;re all set!</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Access your dashboard to book appointments and view health records.
              Questions? Email <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">help@maslogcare.ph</a>.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

const generateWelcomeEmailHTML = (fullname) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroWelcome", `Welcome, ${firstName}`,
      `Your <strong style="color:${C.textDark};">MaslogCare</strong> account is verified and ready. You now have full access to the Barangay Healthcare System.`),
    welcomeGridPartial(),          
    welcomeCtaPartial(),          
    ignoreNoticePartial(),        
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>Welcome to MaslogCare, ${firstName}</title>`)
    .replace(">Verification<", ">Welcome<");
};

module.exports = {
  generateWelcomeEmailHTML,
};