"use strict";
const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");

const maskEmailAddress = (email) => {
  const [local = "", domain = ""] = String(email).split("@");
  if (!domain) return "your registered email";
  return `${local.slice(0, 2)}***@${domain}`;
};

const formatChangedAt = (changedAt) => {
  const date = changedAt instanceof Date ? changedAt : new Date(changedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const detailRow = (label, value) => `
<tr>
  <td style="padding:14px 0;border-bottom:1px solid ${C.mistBorder};">
    <div style="font-size:9.5px;font-weight:700;color:${C.textMuted};letter-spacing:1.4px;text-transform:uppercase;font-family:${fonts.sans};">${label}</div>
    <div style="margin-top:5px;font-size:14px;font-weight:600;color:${C.textDark};font-family:${fonts.sans};">${value}</div>
  </td>
</tr>`;

const detailsPartial = (email, changedAt) => `
<tr>
  <td style="background:${C.white};padding:4px 36px 10px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
           style="background:${C.mist};border:1px solid ${C.mistBorder};border-radius:14px;">
      <tr><td style="padding:6px 22px 10px;">
        <table cellpadding="0" cellspacing="0" width="100%" role="presentation">
          ${detailRow("Account", maskEmailAddress(email))}
          ${detailRow("Date &amp; Time", formatChangedAt(changedAt))}
        </table>
      </td></tr>
    </table>
  </td>
</tr>`;

const outcomePartial = () => `
<tr>
  <td style="background:${C.white};padding:14px 36px 6px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
           style="background:${C.sageBg};border:1px solid ${C.sageBorder};border-radius:14px;margin-bottom:12px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:13px;font-weight:700;color:${C.sageText};font-family:${fonts.sans};">If you made this change</div>
        <p style="margin:5px 0 0;font-size:12.5px;color:${C.textMid};line-height:1.7;font-family:${fonts.sans};">
          No further action is required. You can sign in with your new password.
        </p>
      </td></tr>
    </table>

    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
           style="background:#FDF2F2;border:1px solid #F3C9C4;border-radius:14px;">
      <tr><td style="padding:16px 20px;">
        <div style="font-size:13px;font-weight:700;color:${C.red};font-family:${fonts.sans};">Didn&rsquo;t make this change?</div>
        <p style="margin:5px 0 0;font-size:12.5px;color:${C.textMid};line-height:1.7;font-family:${fonts.sans};">
          Contact the MaslogCare administrator or your Barangay Maslog health office
          immediately so your account can be secured.
        </p>
      </td></tr>
    </table>
  </td>
</tr>`;

const securityReminderPartial = () => `
<tr>
  <td style="background:${C.white};padding:16px 36px 26px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
           style="background:${C.goldBg};border:1px solid ${C.goldBorder};border-radius:12px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0;font-size:12px;color:${C.goldText};line-height:1.7;font-family:${fonts.sans};">
          <strong>Security reminder:</strong> MaslogCare will never ask you to send your
          password or verification code by email. Never share them with anyone.
        </p>
      </td></tr>
    </table>
  </td>
</tr>`;

const generatePasswordChangedHTML = (fullname, email, changedAt) => {
  const year = new Date().getFullYear();
  const firstName = String(fullname || "there").trim().split(/\s+/)[0];

  const body = [
    heroPartial(
      "heroNotif",
      "Password Changed",
      `Hello <strong style="color:${C.textDark};">${firstName}</strong>, your MaslogCare account password was successfully changed. This message confirms the update.`
    ),
    detailsPartial(email, changedAt),
    outcomePartial(),
    securityReminderPartial(),
    ignoreNoticePartial(),
  ].join("\n");

  return require("../utils")
    .emailWrapper(body, year)
    .replace("<title></title>", "<title>MaslogCare – Your Password Has Been Changed</title>")
    .replace(">Verification<", ">Security<");
};

module.exports = { generatePasswordChangedHTML, maskEmailAddress };
